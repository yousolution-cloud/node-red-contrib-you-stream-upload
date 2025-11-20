module.exports = function (RED) {
  const Busboy = require('busboy');

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
      const busboy = Busboy({ headers: req.headers });

      busboy.on('file', (fieldname, file, info) => {
        node.send({
          payload: file,
          filename: info.filename,
          mimetype: info.mimeType,
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
    };

    // Register route in SAME WAY as http in
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
