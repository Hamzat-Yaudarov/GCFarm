const migrations = require('./db/migrations');
const users = require('./db/repos/users');
const withdrawals = require('./db/repos/withdrawals');
const tasks = require('./db/repos/tasks');

module.exports = Object.assign({}, migrations, users, withdrawals, tasks);
