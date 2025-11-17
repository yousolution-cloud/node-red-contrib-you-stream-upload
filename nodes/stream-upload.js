// stream-upload.js - MODIFICATO per usare pg-config
module.exports = function (RED) {
  const Busboy = require('busboy');
  const { Pool } = require('pg');
  const { LargeObjectManager } = require('pg-large-object');

  function StreamUpload(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // 🔥 OTTIENI LA CONFIGURAZIONE
    const pgConfigNode = RED.nodes.getNode(config.pgConfig);
    if (!pgConfigNode) {
      node.error('❌ Nodo di configurazione PostgreSQL mancante!');
      return;
    }

    const pool = new Pool({
      host: process.env.PGHOST || pgConfigNode.host,
      user: process.env.PGUSER || pgConfigNode.user,
      password: process.env.PGPASSWORD || pgConfigNode.credentials.password,
      database: process.env.PGDATABASE || pgConfigNode.database,
      port: process.env.PGPORT
        ? parseInt(process.env.PGPORT)
        : pgConfigNode.port,
    });

    pool.on('error', (err) => {
      node.error('Errore connessione Postgres: ' + err.toString());
    });

    const endpoint = '/pg-upload';

    RED.httpNode.post(endpoint, (req, res) => {
      const busboy = Busboy({ headers: req.headers });

      busboy.on('file', (fieldname, file, info) => {
        const filename = info.filename || 'unknown_file';

        (async () => {
          const client = await pool.connect();
          let oid = null;

          try {
            await client.query('BEGIN');

            const lom = new LargeObjectManager({ pg: client });
            const [loid, pgStream] = await lom.createAndWritableStreamAsync();
            oid = loid;

            console.log(`📦 Creato Large Object con OID: ${oid}`);

            // Pipe con gestione errori completa
            file.pipe(pgStream);

            await new Promise((resolve, reject) => {
              pgStream
                .on('finish', () => {
                  console.log(`✅ Stream finalizzato per OID: ${oid}`);
                  resolve();
                })
                .on('error', reject);

              file.on('error', reject);
            });

            const verify = await client.query(
              'SELECT COUNT(*) FROM pg_largeobject WHERE loid = $1',
              [oid]
            );
            console.log(
              `🔍 Chunk scritti prima del commit:`,
              verify.rows[0].count
            );

            await client.query('COMMIT');
            console.log(`✅ COMMIT eseguito per OID: ${oid}`);

            res.json({ status: 'ok', oid, filename });

            // Output per flow Node-RED
            node.send({
              payload: {
                oid: oid,
                filename: filename,
                mimetype: info.mimeType,
              },
            });
          } catch (err) {
            console.error(`❌ ERRORE COMPLETO:`, err);
            await client.query('ROLLBACK');
            res.status(500).json({ error: err.message });
          } finally {
            client.release();
          }
        })();
      });

      busboy.on('error', (err) => {
        console.error('❌ Errore busboy:', err);
        res.status(500).json({ error: err.message });
      });

      req.pipe(busboy);
    });

    node.log('Stream Upload in ascolto: POST ' + endpoint);
  }

  RED.nodes.registerType('stream-upload', StreamUpload);
};
