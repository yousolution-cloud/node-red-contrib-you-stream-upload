const { Pool } = require("pg");
const { LargeObjectManager } = require("pg-large-object");

const sharedPools = {};

function getPool(RED, configNode) {
    const id = configNode.id;
    if (!sharedPools[id]) {
        const pool = new Pool({
            host: configNode.host,
            port: configNode.port,
            user: configNode.user,
            password: configNode.credentials.password,
            database: configNode.database,
        });

        pool.on("error", err => {
            RED.log.error("[pg-response-stream] PG pool error: " + err.message);
        });

        sharedPools[id] = pool;
    }
    return sharedPools[id];
}

module.exports = function (RED) {

    function PgResponseStreamNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        const pgConfigNode = RED.nodes.getNode(config.pgConfig);
        if (!pgConfigNode) {
            node.status({ fill: "red", shape: "ring", text: "Missing PG config" });
            node.error("Missing PostgreSQL configuration.");
            return;
        }

        const pool = getPool(RED, pgConfigNode);

        node.on("input", async function (msg) {

            // ------------------------------------
            // Normalizza msg.res
            // ------------------------------------
            if (!msg.res && !msg._res) {
                node.error("No msg.res/msg._res present");
                return;
            }

            let res = msg.res || msg._res;

            if (res && !res.setHeader) {
                if (msg._res && typeof msg._res.setHeader === "function") {
                    res = msg._res;
                } else if (res._res && typeof res._res.setHeader === "function") {
                    res = res._res;
                }
            }

            if (!res || typeof res.write !== "function") {
                node.error("Invalid HTTP response object");
                return;
            }

            // ------------------------------------
            // OID
            // ------------------------------------
            const oidProp = config.oidProperty || "payload";
            const oid = Number(RED.util.getMessageProperty(msg, oidProp));

            if (!oid || isNaN(oid)) {
                res.status?.(400);
                return res.end("Invalid OID.");
            }

            // ------------------------------------
            // PG Client
            // ------------------------------------
            let client;
            try {
                client = await pool.connect();
            } catch (err) {
                node.error("PG connection failed: " + err.message);
                res.status?.(503);
                return res.end("Database unavailable.");
            }

            let released = false;

            async function safeRelease(mode) {
                if (released) return;
                released = true;

                try {
                    if (mode === "commit") await client.query("COMMIT");
                    else if (mode === "rollback") await client.query("ROLLBACK");
                } catch (err) {
                    node.warn("Transaction cleanup error: " + err.message);
                }

                try { client.release(); } catch { }
            }

            try {
                await client.query("BEGIN");

                const lom = new LargeObjectManager({ pg: client });
                const lo = await lom.openAsync(oid, LargeObjectManager.READ);

                const filename = msg.filename || config.filename || `oid-${oid}.bin`;
                const contentType = msg.mimetype || config.contentType || "application/octet-stream";
                const disposition = config.contentDisposition || "attachment";

                // headers
                try {
                    res.setHeader("Content-Type", contentType);
                    res.setHeader("Content-Disposition", `${disposition}; filename="${filename}"`);
                    res.setHeader("Transfer-Encoding", "chunked");
                } catch (err) {
                    res.writeHead(200, {
                        "Content-Type": contentType,
                        "Content-Disposition": `${disposition}; filename="${filename}"`,
                        "Transfer-Encoding": "chunked"
                    });
                }

                const CHUNK = 1024 * 1024;

                async function pump() {
                    try {
                        const chunk = await lo.readAsync(CHUNK);

                        // fine file
                        if (!chunk || chunk.length === 0) {
                            await lo.closeAsync();
                            await safeRelease("commit");
                            return res.end();
                        }

                        const ok = res.write(chunk);
                        if (!ok)
                            return res.once("drain", pump);

                        pump();

                    } catch (err) {
                        node.error("Stream error: " + err.message);
                        await safeRelease("rollback");
                        return res.end("Error streaming file.");
                    }
                }

                // client disconnect
                res.on("close", async () => {
                    if (!released) {
                        node.warn(`Client disconnected (OID ${oid})`);
                        await safeRelease("rollback");
                    }
                });

                pump();

            } catch (err) {
                await safeRelease("rollback");

                if (/does not exist/.test(err.message)) {
                    res.status?.(404);
                    return res.end("File not found.");
                }

                node.error("LO access error: " + err.message);
                res.status?.(500);
                res.end("Internal server error.");
            }
        });
    }

    RED.nodes.registerType("pg-response-stream", PgResponseStreamNode);

    process.on("exit", () => {
        Object.values(sharedPools).forEach(p => p.end());
    });
};
