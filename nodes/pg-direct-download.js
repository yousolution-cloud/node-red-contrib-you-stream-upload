// pg-direct-download.js
const { Pool } = require('pg');
const { LargeObjectManager } = require('pg-large-object');

// Module-level cache for connection pools. One pool per config node.
const sharedPools = {};

/**
 * Gets or creates a shared PostgreSQL connection pool for a given config node.
 * This prevents creating new pools on every deploy for the same configuration.
 * @param {object} RED The Node-RED runtime object.
 * @param {object} configNode The PostgreSQL config node from Node-RED.
 * @returns {Pool} The pg Pool instance.
 */
function getPool(RED, configNode) {
  const poolId = configNode.id;
  if (!sharedPools[poolId]) {
    const newPool = new Pool({
      host: configNode.host,
      port: configNode.port,
      user: configNode.user,
      password: configNode.credentials.password,
      database: configNode.database,
    });
    newPool.on('error', (err) => {
      RED.log.error(
        `[pg-direct-download] Shared pool error for ${poolId}: ${err.message}`
      );
    });
    sharedPools[poolId] = newPool;
  }
  return sharedPools[poolId];
}

module.exports = function (RED) {
  'use strict';

  function PgDirectDownloadNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    const pgConfigNode = RED.nodes.getNode(config.pgConfig);
    if (!pgConfigNode) {
      node.status({ fill: 'red', shape: 'ring', text: 'Missing PG config' });
      node.error('PostgreSQL configuration is missing or incorrect.');
      return;
    }

    const pool = getPool(RED, pgConfigNode);

    const endpoint = (config.endpoint || '/pg-download').startsWith('/')
      ? config.endpoint
      : '/' + config.endpoint;
    const routePath = `${endpoint}/:oid`;

    const handler = async function (req, res) {
      const oid = Number(req.params.oid);
      if (isNaN(oid) || oid <= 0) {
        node.warn(`Invalid OID received: ${req.params.oid}`);
        return res.status(400).send('Invalid OID format.');
      }

      let client;
      try {
        client = await pool.connect();
      } catch (err) {
        node.error(`Failed to get client from pool: ${err.message}`, { oid });
        return res.status(503).send('Database connection unavailable.');
      }

      let largeObject;
      let cleaningUp = false;
      const cleanup = async (commit = false) => {
        if (cleaningUp) return;
        cleaningUp = true;

        if (!client) return;
        try {
          if (largeObject) {
            await largeObject.closeAsync();
          }
          await client.query(commit ? 'COMMIT' : 'ROLLBACK');
        } catch (dbErr) {
          node.error(
            `Failed to cleanup (close/commit/rollback) tx for OID ${oid}: ${dbErr.message}`
          );
        } finally {
          if (client) {
            client.release();
            client = null; // Prevent multiple releases
          }
        }
      };

      try {
        await client.query('BEGIN');
        const lom = new LargeObjectManager({ pg: client });

        // Correct Flow: 1. Open, 2. Size, 3. Stream
        largeObject = await lom.openAsync(oid, LargeObjectManager.READ);
        const size = await largeObject.sizeAsync();
        const loStream = largeObject.getReadableStream();

        node.log(`Streaming OID ${oid}, size: ${size} bytes`);

        res.setHeader('Content-Length', size);
        res.setHeader(
          'Content-Type',
          config.contentType || 'application/octet-stream'
        );
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${config.filename || `oid-${oid}.bin`}"`
        );

        loStream.pipe(res);

        loStream.on('end', () => cleanup(true));
        loStream.on('error', (err) => {
          node.error(`Stream error for OID ${oid}: ${err.message}`);
          cleanup(false);
        });

        req.on('close', () => {
          node.warn(`Client disconnected for OID ${oid}. Cleaning up.`);
          if (typeof loStream.destroy === 'function') {
            loStream.destroy();
          }
          cleanup(false);
        });
      } catch (err) {
        if (
          err.message.includes('large object') &&
          err.message.includes('does not exist')
        ) {
          node.warn(`Attempt to access non-existent OID ${oid}.`);
          if (!res.headersSent) res.status(404).send('File not found.');
        } else {
          node.error(`Error processing OID ${oid}: ${err.message}`);
          if (!res.headersSent)
            res.status(500).send('An internal error occurred.');
        }
        cleanup(false);
      }
    };

    RED.httpNode.get(routePath, handler);
    node.log(`Registered direct download route: GET ${routePath}`);

    node.on('close', (done) => {
      const router = RED.httpNode.app._router.stack;
      for (let i = router.length - 1; i >= 0; i--) {
        const layer = router[i];
        if (
          layer.route &&
          layer.route.path === routePath &&
          layer.route.methods.get
        ) {
          router.splice(i, 1);
        }
      }
      node.log(`Unregistered direct download route: GET ${routePath}`);
      done();
    });
  }

  RED.nodes.registerType('pg-direct-download', PgDirectDownloadNode);

  process.on('exit', () => {
    Object.values(sharedPools).forEach((pool) => pool.end());
  });
};
