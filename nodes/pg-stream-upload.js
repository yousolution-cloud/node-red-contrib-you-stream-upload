module.exports = function (RED) {
  const { Pool } = require('pg');
  const { LargeObjectManager } = require('pg-large-object');
  const { Readable } = require('stream');

  const sharedPools = {};

  function getPool(configNode) {
    const poolId = configNode.id;
    if (!sharedPools[poolId]) {
      RED.log.info(
        `Creating new persistent shared PostgreSQL pool for config: ${poolId}`
      );
      const newPool = new Pool({
        host: configNode.host,
        port: configNode.port,
        user: configNode.user,
        password: configNode.credentials.password,
        database: configNode.database,
      });
      newPool.on('error', (err) => {
        RED.log.error(
          `[pg-stream-upload] Shared pool error for ${poolId}: ${err.message}`
        );
      });
      sharedPools[poolId] = newPool;
    }
    return sharedPools[poolId];
  }

  function PgStreamUpload(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    const pgConfigNode = RED.nodes.getNode(config.pgConfig);
    if (!pgConfigNode) {
      node.status({ fill: 'red', shape: 'ring', text: 'Missing PG config' });
      return;
    }

    const pool = getPool(pgConfigNode);
    const globalContext = node.context().global;

    node.on('input', async (msg, send, done) => {
      const streamId = msg.payload;
      const registry = globalContext.get('_YOU_STREAM_REGISTRY') || {};
      const fileStream = registry[streamId];

      if (!fileStream || !(fileStream instanceof Readable)) {
        const errMsg = `Stream not found for id: ${streamId}`;
        node.error(errMsg, msg);
        if (done) done(new Error(errMsg));
        return;
      }

      // Rimuovi lo stream dalla registry
      delete registry[streamId];
      globalContext.set('_YOU_STREAM_REGISTRY', registry);

      const filename = msg.filename || 'unknown_file';
      const mimetype = msg.mimetype || 'application/octet-stream';

      node.status({ fill: 'blue', shape: 'dot', text: 'uploading' });

      let client;
      try {
        client = await pool.connect();
      } catch (err) {
        node.error('Failed to get client from pool: ' + err.message, msg);
        node.status({ fill: 'red', shape: 'ring', text: 'Connection failed' });
        if (done) done(err);
        return;
      }

      try {
        await client.query('BEGIN');
        const lom = new LargeObjectManager({ pg: client });
        const [oid, pgStream] = await lom.createAndWritableStreamAsync();

        fileStream.pipe(pgStream);

        await new Promise((resolve, reject) => {
          pgStream.on('finish', resolve);
          pgStream.on('error', reject);
          fileStream.on('error', reject);
        });

        await client.query('COMMIT');
        node.status({ fill: 'green', shape: 'dot', text: 'upload complete' });
        send({ payload: { oid, filename, mimetype } });
        if (done) done();
      } catch (err) {
        node.status({ fill: 'red', shape: 'ring', text: 'upload failed' });
        node.error('Error during large object upload: ' + err.message, msg);
        if (client) {
          await client.query('ROLLBACK');
        }
        if (done) done(err);
      } finally {
        if (client) client.release();
      }
    });

    node.on('close', (done) => {
      done();
    });
  }

  RED.nodes.registerType('pg-stream-upload', PgStreamUpload);
};
