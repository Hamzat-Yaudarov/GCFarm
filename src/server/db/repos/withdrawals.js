const { pool } = require('../pool');
const { WITHDRAWAL_METHODS } = require('../../config/withdrawals');

function sanitizeText(value, maxLength = 255) {
  if (value === undefined || value === null) return '';
  const str = String(value).trim();
  if (!str) return '';
  return str.slice(0, maxLength);
}

function normalizeWithdrawalDetails(methodKey, rawDetails = {}) {
  const method = WITHDRAWAL_METHODS[methodKey];
  if (!method) {
    return { details: {}, missing: ['method'] };
  }
  const output = {};
  const missing = [];
  const fields = Array.isArray(method.fields) ? method.fields : [];
  fields.forEach((field) => {
    const original = rawDetails[field.id];
    const sanitized = sanitizeText(original, field.maxLength || 255);
    if (field.required && !sanitized) {
      missing.push(field.id);
    }
    if (sanitized) {
      output[field.id] = sanitized;
    }
  });
  return { details: output, missing };
}

function mapWithdrawalRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    tgid: Number(row.tgid),
    method: row.method,
    optionId: row.option_id,
    payoutLabel: row.payout_label,
    baseCost: Number(row.base_cost),
    commission: Number(row.commission),
    totalCost: Number(row.total_cost),
    status: row.status,
    details: row.details || {},
    note: row.note || '',
    adminComment: row.admin_comment || '',
    adminTgid: row.admin_tgid ? Number(row.admin_tgid) : null,
    adminUsername: row.admin_username || null,
    adminFullname: row.admin_fullname || null,
    successIndex: row.success_index !== null && row.success_index !== undefined ? Number(row.success_index) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    userSnapshot: row.user_snapshot || null
  };
}

function getWithdrawalOption(methodKey, optionId) {
  const method = WITHDRAWAL_METHODS[methodKey];
  if (!method) return null;
  const option = method.options[optionId];
  if (!option) return null;
  const baseCost = Number(option.baseCost || 0);
  const commission = Number(option.commission || 0);
  return {
    methodKey,
    methodLabel: method.label,
    optionId,
    payoutLabel: option.payoutLabel,
    baseCost,
    commission,
    totalCost: baseCost + commission
  };
}

async function createWithdrawalRequest(tgid, methodKey, optionId, rawDetails = {}, note = '', metadata = {}) {
  const option = getWithdrawalOption(methodKey, optionId);
  if (!option) {
    return { ok:false, message: 'Неверный вариант вывода' };
  }
  const normalized = normalizeWithdrawalDetails(methodKey, rawDetails || {});
  if (normalized.missing.length) {
    return { ok:false, message: 'Заполните обязательные поля', missing: normalized.missing };
  }

  const cleanedNote = sanitizeText(note, 1000);
  const metaUsername = metadata && metadata.username ? sanitizeText(metadata.username, 64) : null;
  const metaFullName = metadata && metadata.fullName ? sanitizeText(metadata.fullName, 128) : null;
  const metaDisplayName = metadata && metadata.displayName ? sanitizeText(metadata.displayName, 128) : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userRes = await client.query('SELECT name, scube, gcube, stars FROM users WHERE tgid = $1 FOR UPDATE', [tgid]);
    if (!userRes.rows.length) {
      await client.query('ROLLBACK');
      return { ok:false, message: 'Пользователь не найден' };
    }
    const user = userRes.rows[0];
    const scubeBefore = Number(user.scube || 0);
    if (scubeBefore < option.totalCost) {
      await client.query('ROLLBACK');
      return { ok:false, message: 'Недостаточно SCube', scube: scubeBefore };
    }
    const scubeAfter = scubeBefore - option.totalCost;
    await client.query('UPDATE users SET scube = $1 WHERE tgid = $2', [scubeAfter, tgid]);

    const userSnapshot = {
      name: user.name || null,
      displayName: metaDisplayName || null,
      username: metaUsername || null,
      fullName: metaFullName || null,
      scubeBefore,
      scubeAfter,
      gcube: Number(user.gcube || 0),
      stars: Number(user.stars || 0)
    };
    Object.keys(userSnapshot).forEach((key) => {
      if (userSnapshot[key] === null || userSnapshot[key] === undefined) {
        delete userSnapshot[key];
      }
    });

    const insertRes = await client.query(
      `INSERT INTO withdrawals (
        tgid, method, option_id, payout_label, base_cost, commission, total_cost, status, details, note, user_snapshot
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10
      ) RETURNING *`,
      [
        tgid,
        methodKey,
        optionId,
        option.payoutLabel,
        option.baseCost,
        option.commission,
        option.totalCost,
        Object.keys(normalized.details).length ? normalized.details : null,
        cleanedNote || null,
        userSnapshot
      ]
    );

    await client.query('COMMIT');
    return { ok:true, withdrawal: mapWithdrawalRow(insertRes.rows[0]), scube: scubeAfter };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getWithdrawalById(id) {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT * FROM withdrawals WHERE id = $1', [id]);
    if (!res.rows.length) return null;
    return mapWithdrawalRow(res.rows[0]);
  } finally {
    client.release();
  }
}

async function completeWithdrawal(id, adminData = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query('SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE', [id]);
    if (!res.rows.length) {
      await client.query('ROLLBACK');
      return { ok:false, reason: 'not_found' };
    }
    const row = res.rows[0];
    if (row.status !== 'pending') {
      await client.query('ROLLBACK');
      return { ok:false, reason: 'already_processed', status: row.status, withdrawal: mapWithdrawalRow(row) };
    }

    let successIndex = row.success_index;
    if (successIndex === null || successIndex === undefined) {
      const seqRes = await client.query("SELECT nextval('withdrawal_success_seq') AS seq");
      successIndex = Number(seqRes.rows[0].seq);
    }

    const adminUsername = adminData && adminData.username ? sanitizeText(adminData.username, 64) : null;
    const adminFullName = adminData && adminData.fullName ? sanitizeText(adminData.fullName, 128) : null;
    const adminComment = adminData && adminData.comment ? sanitizeText(adminData.comment, 500) : null;
    const adminTgid = adminData && adminData.tgid ? Number(adminData.tgid) : null;

    const updateRes = await client.query(
      `UPDATE withdrawals
         SET status = 'completed',
             admin_comment = $2,
             admin_tgid = $3,
             admin_username = $4,
             admin_fullname = $5,
             success_index = $6,
             user_snapshot = COALESCE(user_snapshot, '{}'::jsonb) || jsonb_build_object('completedAt', now()),
             updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, adminComment || null, adminTgid, adminUsername, adminFullName, successIndex]
    );

    await client.query('COMMIT');
    return { ok:true, withdrawal: mapWithdrawalRow(updateRes.rows[0]) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function declineWithdrawal(id, adminData = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query('SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE', [id]);
    if (!res.rows.length) {
      await client.query('ROLLBACK');
      return { ok:false, reason: 'not_found' };
    }
    const row = res.rows[0];
    if (row.status !== 'pending') {
      await client.query('ROLLBACK');
      return { ok:false, reason: 'already_processed', status: row.status, withdrawal: mapWithdrawalRow(row) };
    }

    const adminUsername = adminData && adminData.username ? sanitizeText(adminData.username, 64) : null;
    const adminFullName = adminData && adminData.fullName ? sanitizeText(adminData.fullName, 128) : null;
    const adminComment = adminData && adminData.comment ? sanitizeText(adminData.comment, 500) : null;
    const adminTgid = adminData && adminData.tgid ? Number(adminData.tgid) : null;

    const userRes = await client.query('SELECT scube FROM users WHERE tgid = $1 FOR UPDATE', [row.tgid]);
    if (!userRes.rows.length) {
      await client.query('ROLLBACK');
      return { ok:false, reason: 'user_not_found' };
    }
    const scubeBefore = Number(userRes.rows[0].scube || 0);
    const refund = Number(row.total_cost || 0);
    const scubeAfter = scubeBefore + refund;
    await client.query('UPDATE users SET scube = $1 WHERE tgid = $2', [scubeAfter, row.tgid]);

    const updateRes = await client.query(
      `UPDATE withdrawals
         SET status = 'declined',
             admin_comment = $2,
             admin_tgid = $3,
             admin_username = $4,
             admin_fullname = $5,
             user_snapshot = COALESCE(user_snapshot, '{}'::jsonb) || jsonb_build_object('refundedAt', now(), 'scubeAfterRefund', $6),
             updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, adminComment || null, adminTgid, adminUsername, adminFullName, scubeAfter]
    );

    await client.query('COMMIT');
    return { ok:true, withdrawal: mapWithdrawalRow(updateRes.rows[0]), scube: scubeAfter };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  WITHDRAWAL_METHODS,
  getWithdrawalOption,
  normalizeWithdrawalDetails,
  mapWithdrawalRow,
  createWithdrawalRequest,
  getWithdrawalById,
  completeWithdrawal,
  declineWithdrawal
};
