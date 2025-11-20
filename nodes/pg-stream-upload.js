module.exports = function (RED) {
  const { Pool } = require('pg');
  const { LargeObjectManager } = require('pg-large-object');
  const { Readable } = require('stream');

  // A simple, persistent cache for shared pools.
  // Pools are created once per config and never destroyed during the Node-RED lifecycle.
  // This is the most robust way to prevent race conditions on redeploy.
  const sharedPools = {};

  function getPool(configNode) {
    const poolId = configNode.id;
    if (!sharedPools[poolId]) {
      RED.log.info(
        `Creating new persistent shared PostgreSQL pool for config: ${poolId}`
      );
      // This is the corrected configuration, accessing credentials directly from the config node.
      const newPool = new Pool({
        host: configNode.host,
        port: configNode.port,
        user: configNode.user, // User from config
        password: configNode.credentials.password, // Password from credentials
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

    // This will now correctly create or reuse a stable pool.
    const pool = getPool(pgConfigNode);

    node.on('input', async (msg, send, done) => {
      const fileStream = msg.payload;
      const filename = msg.filename || 'unknown_file';
      const mimetype = msg.mimetype || 'application/octet-stream';

      if (!(fileStream instanceof Readable)) {
        const errMsg = 'Input payload is not a readable stream.';
        node.error(errMsg, msg);
        if (done) {
          done(new Error(errMsg));
        }
        return;
      }

      node.status({ fill: 'blue', shape: 'dot', text: 'uploading' });
      let client;
      try {
        // This call should no longer hang after a redeploy.
        client = await pool.connect();
      } catch (err) {
        node.error('Failed to get client from pool: ' + err.message, msg);
        node.status({ fill: 'red', shape: 'ring', text: 'Connection failed' });
        if (done) {
          done(err);
        }
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
        send({ payload: { oid, filename: filename, mimetype: mimetype } });
        if (done) {
          done();
        }
      } catch (err) {
        node.status({ fill: 'red', shape: 'ring', text: 'upload failed' });
        node.error('Error during large object upload: ' + err.message, msg);
        if (client) {
          await client.query('ROLLBACK');
        }
        if (done) {
          done(err);
        }
      } finally {
        if (client) {
          client.release();
        }
      }
    });

    // The 'close' handler is intentionally left empty regarding the pool.
    // The pool is shared and persistent across deploys.
    node.on('close', (done) => {
      done();
    });
  }

  RED.nodes.registerType('pg-stream-upload', PgStreamUpload);
};
