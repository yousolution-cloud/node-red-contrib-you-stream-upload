// pg-stream-upload.js
module.exports = function (RED) {
  const { Pool } = require('pg');
  const { LargeObjectManager } = require('pg-large-object');
  const { Readable } = require('stream');

  function PgStreamUpload(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Get PostgreSQL configuration
    const pgConfigNode = RED.nodes.getNode(config.pgConfig);
    if (!pgConfigNode) {
      node.status({ fill: 'red', shape: 'ring', text: 'Missing PG config' });
      node.error('Missing PostgreSQL configuration');
      return;
    }

    const pool = new Pool({
      host: pgConfigNode.host,
      user: pgConfigNode.user,
      password: pgConfigNode.credentials.password,
      database: pgConfigNode.database,
      port: pgConfigNode.port,
    });

    pool.on('error', (err) => {
      node.error('Postgres connection pool error: ' + err.toString());
      node.status({ fill: 'red', shape: 'ring', text: 'Pool Error' });
    });

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
        client = await pool.connect();
      } catch (err) {
        node.error('Failed to connect to PostgreSQL: ' + err.message, msg);
        node.status({ fill: 'red', shape: 'ring', text: 'Connection failed' });
        if (done) {
          done(err);
        }
        return;
      }

      let oid = null;
      try {
        await client.query('BEGIN');

        const lom = new LargeObjectManager({ pg: client });
        const [loid, pgStream] = await lom.createAndWritableStreamAsync();
        oid = loid;

        // Pipe the file stream to the PostgreSQL large object stream
        fileStream.pipe(pgStream);

        // Wait for the upload to complete
        await new Promise((resolve, reject) => {
          pgStream.on('finish', resolve);
          pgStream.on('error', reject);
          fileStream.on('error', reject); // also handle errors from the source stream
        });

        await client.query('COMMIT');

        node.status({ fill: 'green', shape: 'dot', text: 'upload complete' });

        // Send the output message
        send({
          payload: {
            oid: oid,
            filename: filename,
            mimetype: mimetype,
          },
        });

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

    node.on('close', (done) => {
      pool.end(() => {
        node.log('PostgreSQL pool closed.');
        done();
      });
    });
  }

  RED.nodes.registerType('pg-stream-upload', PgStreamUpload);
};
