module.exports = function (RED) {
  /**
   * Defines the configuration node for PostgreSQL connections.
   * This node holds the connection details and credentials.
   * @param {object} n The configuration object from the Node-RED UI.
   */
  function PostgreSQLConfigNode(n) {
    // Register this node with the Node-RED runtime
    RED.nodes.createNode(this, n);

    // Assign connection properties from the UI configuration.
    // These are the non-sensitive parts of the connection.
    this.host = n.host;
    this.port = n.port;
    this.database = n.database;

    // The 'user' is treated as a credential and is accessed from the
    // special 'credentials' object, which is securely managed by Node-RED.
    this.user = this.credentials.user;

    // IMPORTANT: The password is intentionally NOT assigned to a top-level
    // property (e.g., `this.password`). It should only ever be accessed
    // via `this.credentials.password` by the nodes that use this configuration.
    // This prevents it from being accidentally exposed in the editor or logs.
  }

  // Register the node type with Node-RED
  RED.nodes.registerType('pg-config', PostgreSQLConfigNode, {
    // Define the properties that Node-RED should treat as credentials.
    // These will be encrypted in the flows file and only exposed to the
    // server-side runtime.
    credentials: {
      user: { type: 'text' },
      password: { type: 'password' },
    },
  });
};
