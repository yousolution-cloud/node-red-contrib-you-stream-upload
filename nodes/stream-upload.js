module.exports = function (RED) {
  const Busboy = require('busboy');
  const { Pool } = require('pg');
  const { LargeObjectManager } = require('pg-large-object');

  function PgStreamUpload(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    const pool = new Pool({
      host: process.env.PGHOST || 'postgres',
      user: process.env.PGUSER || 'nodered',
      password: process.env.PGPASSWORD || 'noderedpass',
      database: process.env.PGDATABASE || 'filesdb',
      port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 5432,
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

            // DEBUG: verifica connessione
            const userCheck = await client.query(
              'SELECT current_user, inet_server_addr()'
            );
            console.log('🔍 Connessione attiva:', userCheck.rows[0]);

            const lom = new LargeObjectManager({ pg: client });
            const [loid, pgStream] = await lom.createAndWritableStreamAsync();
            oid = loid;

            console.log(`📦 Creato Large Object con OID: ${oid}`);

            // **CRITICO**: pipe con gestione errori completa
            file.pipe(pgStream);

            // **CRITICO**: attendi il completamento dello stream
            await new Promise((resolve, reject) => {
              pgStream
                .on('finish', () => {
                  console.log(`✅ Stream finalizzato per OID: ${oid}`);
                  resolve();
                })
                .on('error', reject);

              file.on('error', reject);
            });

            // **CRITICO**: verifica prima del commit
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

    node.log('Pg Stream Upload in ascolto: POST ' + endpoint);
  }

  RED.nodes.registerType('stream-upload', PgStreamUpload);
};
