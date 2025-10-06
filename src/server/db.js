const migrations = require('./db/migrations');
const users = require('./db/repos/users');
const withdrawals = require('./db/repos/withdrawals');

module.exports = Object.assign({}, migrations, users, withdrawals);
