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
    function send(obj) { conn.send(JSON.stringify(obj)); }
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
            if (!msg.file) {
                send({error: rjs.ERROR_MISSING_FILE});
                return;
            }
            if (db[msg.file]) {
                send({error: rjs.ERROR_FILE_ALREADY_INDEXED});
                return;
            }
            var index = function() {
                var start;
                if (verbose)
                    start = new Date();
                delete db[msg.file];
                var source = safe.fs.readFileSync(msg.file, { encoding:'utf8' });
                if (!source) {
                    console.error("Couldn't open", msg.file, "for reading");
                    if (conn)
                        send({error: rjs.ERROR_READFAILURE});
                    return false;
                }

                if (conn)
                    send({error: rjs.ERROR_OK});
                var ret = indexer.indexFile(source, msg.file, verbose);
                if (verbose) {
                    console.log("Indexing", msg.file, "took", (new Date() - start), "ms");
                }
                if (!ret) {
                    console.error("Couldn't parse file", msg.file);
                    return false;
                }
                if (verbose)
                    console.log(JSON.stringify(ret, null, 4));
                db[msg.file] = ret;
                return true;
            };
            if (index()) {
                conn = undefined;
                fs.watchFile(msg.file, function(curr, prev) {
                    if (verbose)
                        console.log(msg.file, "was modified");
                    if (curr.mtime !== prev.mtime) {
                        index();
                    }
                });
            }
            break;
        case rjs.MESSAGE_FOLLOW_SYMBOL:
        case rjs.MESSAGE_FIND_REFERENCES:
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
                send({ error: rjs.ERROR_OK, target: symbol.target });
            } else {
                if (!symbol.definition && symbol.target) {
                    var sym = indexer.findLocation(db[msg.location.file].symbols, symbol.target[0]);
                    if (sym)
                        symbol = sym;
                }
                send({ error: rjs.ERROR_OK, references: symbol.references });
            }
            break;
        }
    });
});



