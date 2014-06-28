#!/usr/bin/env node

var safe = require('safetydance');
var fs = require('fs');
var ws = require('ws');
var rjs = require('rjs');
var indexer = require('indexer');
var parseArgs = require('minimist');
var usageString = 'Usage:\n$0 ...options\n  -v|--verbose\n  -p|--port [default ' + rjs.defaultPort + ']\n';
var args = parseArgs(process.argv.slice(2), { alias: { v: 'verbose', 'p': 'port' }, default: { p: rjs.defaultPort } });

var verbose = args.verbose;

var db = {};
var server = new ws.Server({ port:args.port });

server.on('connection', function(conn) {
    if (verbose)
        console.log("Got a connection");
    conn.on('message', function(message) {
        var msgType;
        function send(obj) {
            if (!obj.error)
                obj.error = rjs.ERROR_OK;
            if (typeof msgType !== 'undefined')
                obj.type = msgType;
            if (!conn)
                console.error("connection is gone");
            conn.send(JSON.stringify(obj));
            if (verbose)
                console.log("sending", obj);
        }

        var msg = safe.JSON.parse(message);
        if (verbose)
            console.log("got message", msg);
        if (!msg) {
            send({error: rjs.ERROR_PROTOCOL_ERROR});
            return;
        }
        msgType = msg.type;
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
                var start = new Date();
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
                if (!ret) {
                    console.error("Couldn't parse file", fileName);
                    return false;
                }
                console.log("Indexed", fileName, "in", (new Date() - start), "ms", ret.symbols.length, "symbols and", ret.symbolNames.length, "symbol names");

                if (verbose)
                    console.log(JSON.stringify(ret, null, 4));
                ret.indexTime = indexTime;
                db[fileName] = ret;
                return true;
            };
            if (index()) {
                var onFileModified = function() {
                    var cached = db[fileName];
                    if (verbose)
                        console.log(fileName, "was modified");
                    if (!cached) {
                        fs.unwatch(fileName, onFileModified);
                        return;
                    }
                    var stat = safe.fs.statSync(fileName);
                    if (!stat) {
                        fs.unwatch(fileName, onFileModified);
                        return;
                    }
                    if (verbose)
                        console.log(fileName, "was modified", stat.mtime, cached.indexTime);
                    if (stat.mtime > cached.indexTime) {
                        index();
                    }
                };
                fs.watch(fileName, onFileModified);
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
            var result = indexer.findLocation(db[msg.location.file].symbols, msg.location.offset);
            if (!result) {
                send({error: rjs.ERROR_SYMBOL_NOT_FOUND});
                break;
            }
            function createLocation(loc) {
                return { file: msg.location.file, offset: loc[0] };
            }
            if (verbose)
                console.log("Found symbol", result);
            if (msg.type === rjs.MESSAGE_FOLLOW_SYMBOL) {
                send({ target: createLocation(result.symbol.target) });
            } else if (msg.type === rjs.MESSAGE_CURSOR_INFO) {
                send({ cursorInfo: result.symbol });
            } else {
                var startLoc = result.pos;
                if (!result.symbol.definition && result.symbol.target) {
                    var sym = indexer.findLocation(db[msg.location.file].symbols, result.symbol.target[0]);
                    if (sym)
                        result = sym;
                }
                var references = result.symbol.references;
                for (var idx=0; idx<result.symbol.references.length - 1; ++idx) { // if the current is the last in the array there's no reason to resort
                    if (result.symbol.references[idx][0] === startLoc) {
                        references = result.symbol.references.slice(idx + 1).concat(result.symbol.references.slice(0, idx + 1));
                        break;
                    }
                }
                var refs = [];
                references.forEach(function(value) { refs.push(createLocation(value)); });

                send({ references: refs });
            }
            break;

        case rjs.MESSAGE_FIND_SYMBOLS:
            if (!msg.symbolName) {
                send({error: rjs.ERROR_MISSING_SYMBOLNAME});
                break;
            }

            var locations = [];
            function addLocations(file) {
                var ret = indexer.findSymbolsByName(db[file].symbolNames, msg.symbolName);
                if (ret) {
                    for (var i=0; i<ret.locations.length; ++i) {
                        locations.push({ file: file, offset: ret.locations[i][0] });
                    }
                }
            }
            if (msg.file) {
                if (!db[msg.file]) {
                    send({error: rjs.ERROR_FILE_NOT_INDEXED});
                    break;
                }
                addLocations(msg.file);
            } else {
                for (var f in db) {
                    addLocations(f);
                }
            }
            locations.sort();
            send({ locations: locations });
            break;

        case rjs.MESSAGE_LIST_SYMBOLS:
            var symbolNameObject = {};
            var symbolNameArray = [];
            function listSymbols(symbolNames) {
                var ret = indexer.listSymbols(symbolNames, msg.prefix);
                if (verbose)
                    console.log("Got results", ret);
                for (var i=0; i<ret.symbolNames.length; ++i) {
                    var name = ret.symbolNames[i];
                    if (!symbolNameObject[name]) {
                        symbolNameObject[name] = true;
                        symbolNameArray.push(name);
                    }
                }
            }
            if (msg.file) {
                if (!db[msg.file]) {
                    send({error: rjs.ERROR_FILE_NOT_INDEXED});
                    break;
                }
                listSymbols(db[msg.file].symbolNames);
            } else {
                for (var file in db) {
                    listSymbols(db[file].symbolNames);
                }
            }
            symbolNameArray.sort();
            send({ symbolNames: symbolNameArray });
            break;

        case rjs.MESSAGE_DUMP:
            if (msg.file) {
                if (!db[msg.file]) {
                    send({error: rjs.ERROR_FILE_NOT_INDEXED});
                    break;
                }
                send({ dump: JSON.stringify(db[msg.file], null, 4) });
            } else {
                for (var ff in db) {
                    var entry = db[ff];
                    send({ error: rjs.ERROR_MORE_DATA, dump: ff + " " + entry.indexTime });
                }
                send({});
            }
            break;
        }
    });
});



