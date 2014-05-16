#!/usr/bin/env node

var safe = require('safetydance');
var fs = require('fs');
var ws = require('ws');
var rjs = require('rjs');
var indexer = require('indexer');
var optimist = require('optimist');
var usageString = 'Usage:\n$0 ...options\n  -v|--verbose\n  -p|--port [location]\n';
optimist.usage(usageString);
optimist.default('port', rjs.defaultPort);
if (!optimist.argv.port)
    optimist.argv.port = rjs.defaultPort;

var verbose = 0;
['v', 'verbose'].forEach(function(arg) {
    if (typeof optimist.argv[arg] === 'boolean') {
        ++verbose;
    } else if (optimist.argv[arg] instanceof Array) {
        verbose += optimist.argv[arg].length;
    }
});

var db = {};
// console.log(optimist.argv);
var server = new ws.Server({port:optimist.argv.port});
server.on('connection', function(conn) {
    function send(obj) {
        if (!obj.error)
            obj.error = rjs.ERROR_OK;
        conn.send(JSON.stringify(obj));
    }
    if (verbose)
        console.log("Got a connection");
    conn.on('message', function(message) {
        var msg = safe.JSON.parse(message);
        if (verbose)
            console.log("got message", msg);
        if (!msg) {
            send({error: rjs.ERROR_PROTOCOL_ERROR});
            return;
        }
        switch (msg.type) {
        case rjs.MESSAGE_COMPILE:
            var fileName = msg.file;
            msg = undefined;
            if (!fileName) {
                send({error: rjs.ERROR_MISSING_FILE});
                return;
            }
            if (db[fileName]) {
                var stat = safe.fs.statSync(fileName);
                if (!stat) {
                    send({error: rjs.ERROR_STATFAILURE});
                    return;
                }
                if (stat.mtime <= db[fileName].indexTime) {
                    send({error: rjs.ERROR_FILE_ALREADY_INDEXED});
                    return;
                }
            }
            var index = function() {
                var start;
                if (verbose)
                    start = new Date();
                var source = safe.fs.readFileSync(fileName, { encoding:'utf8' });
                var indexTime = new Date();
                if (!source) {
                    console.error("Couldn't open", fileName, "for reading");
                    if (conn)
                        send({error: rjs.ERROR_READFAILURE});
                    return false;
                }
                if (conn)
                    send({});

                var ret = indexer.indexFile(source, fileName, verbose);
                if (verbose) {
                    console.log("Indexing", fileName, "took", (new Date() - start), "ms");
                }
                if (!ret) {
                    console.error("Couldn't parse file", fileName);
                    return false;
                }
                if (verbose)
                    console.log(JSON.stringify(ret, null, 4));
                ret.indexTime = indexTime;
                db[fileName] = ret;
                return true;
            };
            if (index()) {
                conn = undefined;
                var onFileModified = function(curr, prev) {
                    var cached = db[fileName];
                    if (verbose)
                        console.log(fileName, "was modified");
                    if (!cached) {
                        fs.unwatchFile(fileName, onFileModified);
                        return;
                    }
                    if (verbose)
                        console.log(fileName, "was modified", curr.mtime, cached.indexTime);
                    if (curr.mtime > cached.indexTime) {
                        index();
                    }
                };
                fs.watchFile(fileName, onFileModified);
            }
            break;
        case rjs.MESSAGE_FOLLOW_SYMBOL:
        case rjs.MESSAGE_FIND_REFERENCES:
        case rjs.MESSAGE_CURSOR_INFO:
            if (!msg.location || !msg.location.file || !msg.location.offset) {
                send({error: rjs.ERROR_INVALID_LOCATION});
                break;
            }
            if (!db[msg.location.file]) {
                send({error: rjs.ERROR_FILE_NOT_INDEXED});
                break;
            }
            var symbol = indexer.findLocation(db[msg.location.file].symbols, msg.location.offset);
            if (!symbol) {
                send({error: rjs.ERROR_SYMBOL_NOT_FOUND});
                break;
            }
            if (verbose)
                console.log("Found symbol", symbol);
            if (msg.type === rjs.MESSAGE_FOLLOW_SYMBOL) {
                send({ target: symbol.target });
            } else if (msg.type === rjs.MESSAGE_CURSOR_INFO) {
                send({ cursorInfo: symbol });
            } else {
                if (!symbol.definition && symbol.target) {
                    var sym = indexer.findLocation(db[msg.location.file].symbols, symbol.target[0]);
                    if (sym)
                        symbol = sym;
                }
                send({ references: symbol.references });
            }
            break;
        case rjs.MESSAGE_DUMP:
            if (msg.file) {
                if (!db[msg.file]) {
                    send({error: rjs.ERROR_FILE_NOT_INDEXED});
                    break;
                }
                send({ dump: JSON.stringify(db[msg.file], null, 4) });
            } else {
                for (var file in db) {
                    var entry = db[file];
                    send({ error: rjs.ERROR_MORE_DATA, dump: file + " " + entry.indexTime });
                }
                send({});
            }
            break;
        }
    });
});



