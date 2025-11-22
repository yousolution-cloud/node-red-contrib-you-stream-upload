module.exports = function (RED) {
  const Busboy = require('busboy');
  const { PassThrough } = require('stream');
  const { v4: uuidv4 } = require('uuid');

  function StreamUpload(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    const method = 'post';

    let endpoint = config.endpoint || '/upload-stream';
    if (!endpoint.startsWith('/')) endpoint = '/' + endpoint;

    // =======================
    // 1. Register route like http in node
    // =======================
    node.handler = function (req, res) {
      const globalContext = node.context().global;
      const contentType = req.headers['content-type'] || '';

      // Assicurati che la registry esista
      let registry = globalContext.get('_YOU_STREAM_REGISTRY') || {};
      globalContext.set('_YOU_STREAM_REGISTRY', registry);

      if (contentType.includes('multipart/form-data')) {
        const busboy = Busboy({ headers: req.headers });
        const fields = {};

        busboy.on('field', (fieldname, val) => {
          fields[fieldname] = val;
        });

        busboy.on('file', (fieldname, file, info) => {
          if (Object.keys(fields).length === 0) {
            node.warn(
              'Received file before any fields. If you sent fields, they must be placed BEFORE the file in the multipart request to be included in the message.'
            );
          }

          const id = uuidv4();
          const pass = new PassThrough();
          file.pipe(pass);

          // Salva lo stream nella registry globale
          registry = globalContext.get('_YOU_STREAM_REGISTRY') || {};
          registry[id] = pass;
          globalContext.set('_YOU_STREAM_REGISTRY', registry);

          // Invia il messaggio con l'ID dello stream
          node.send({
            payload: id,
            filename: info.filename,
            mimetype: info.mimeType,
            fields: fields,
          });
        });

        busboy.on('finish', () => {
          if (!res.headersSent) {
            res.json({ status: 'ok' });
          }
        });

        busboy.on('error', (err) => {
          node.error(err);
          if (!res.headersSent) {
            res.status(500).json({ error: err.message });
          }
        });

        req.pipe(busboy);
      } else {
        // Handle binary upload (raw body)
        const id = uuidv4();
        const pass = new PassThrough();
        req.pipe(pass);

        // Salva lo stream nella registry globale
        registry = globalContext.get('_YOU_STREAM_REGISTRY') || {};
        registry[id] = pass;
        globalContext.set('_YOU_STREAM_REGISTRY', registry);

        // Try to extract filename from headers
        let filename = 'binary_upload';
        const contentDisposition = req.headers['content-disposition'];
        if (contentDisposition) {
          const match = contentDisposition.match(/filename="?([^"]+)"?/);
          if (match) {
            filename = match[1];
          }
        }
        if (req.headers['x-filename']) {
          filename = req.headers['x-filename'];
        }

        node.send({
          payload: id,
          filename: filename,
          mimetype: contentType,
          fields: {},
        });

        req.on('end', () => {
          if (!res.headersSent) {
            res.json({ status: 'ok' });
          }
        });

        req.on('error', (err) => {
          node.error(err);
          if (!res.headersSent) {
            res.status(500).json({ error: err.message });
          }
        });
      }
    };

    // Register route in same way as http in
    RED.httpNode[method](endpoint, node.handler);
    node.log(`Registered route POST ${endpoint}`);

    // =======================
    // 2. Cleanup identical to http in node
    // =======================
    node.on('close', function (done) {
      const router = RED.httpNode._router.stack;

      for (let i = 0; i < router.length; i++) {
        const layer = router[i];

        if (
          layer.route &&
          layer.route.path === endpoint &&
          layer.route.methods[method]
        ) {
          router.splice(i, 1);
          break;
        }
      }

      done();
    });
  }

  RED.nodes.registerType('stream-upload', StreamUpload);
};
