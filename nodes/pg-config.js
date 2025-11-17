// pg-config.js
module.exports = function (RED) {
  function PostgreSQLConfig(n) {
    RED.nodes.createNode(this, n);
    this.host = n.host || 'postgres';
    this.port = n.port || 5432;
    this.database = n.database || 'filesdb';
    this.user = this.credentials.user || 'nodered';
    this.password = this.credentials.password || 'noderedpass';
  }

  RED.nodes.registerType('pg-config', PostgreSQLConfig, {
    credentials: {
      user: { type: 'text' },
      password: { type: 'password' },
    },
  });
};
