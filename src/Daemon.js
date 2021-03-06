/*global require, process, __filename, setTimeout, module*/

'use strict';

var Args = require('./Args');
var ws = require('ws');
var log = require('./log');
var safe = require('safetydance');
var rjs = require('./rjs');
var FileSystemWatcher = require('./FileSystemWatcher');
var Indexer = require('./Indexer');
var Preprocessor = require('./Preprocessor');
var DataDir = require('./DataDir');

function addLog(conn, verbose) {
    var output = {
        log: function(str) {
            conn.send(JSON.stringify({type: rjs.MESSAGE_LOG, log: str, error: rjs.ERROR_MORE_DATA }));
        },
        verbosity: verbose ? 2 : 1,
        connection: conn
    };

    function logger(str) {
        conn.send(JSON.stringify({type: rjs.MESSAGE_LOG, log: str, error: rjs.ERROR_MORE_DATA }));
    }
    var sink = new log.Sink(logger, verbose ? 2 : 1);
    sink.conn = conn;
    log.addSink(sink);
}

function removeLog(conn) {
    for (let i=0; i<log.outputs.length; ++i) {
        if (log.outputs[i].connection == conn) {
            log.outputs.splice(i, 1);
            break;
        }
    }
}

function Daemon()
{
    var that = this;
    that.db = {};
    if (Args.args.port && Args.args.server) {
        that.server = new ws.Server({ port: Args.args.port });
        that.server.on('error', function(err) {
            log.log('Got error', err);
            process.exit(1);
        });
        that.server.on('connection', function(conn) {
            log.verboseLog('Got a connection');
            conn.on('close', function(message) {
                if (conn.log) {
                    removeLog(conn);
                }
                conn = undefined;
            });
            conn.on('message', function(message) {
                var msg = safe.JSON.parse(message);
                log.verboseLog('got message', msg);
                if (msg.type == rjs.MESSAGE_LOG) {
                    conn.log = true;
                    addLog(conn, msg.verbose);
                } else {
                    that.processMessage(safe.JSON.parse(message), function(data) {
                        if (conn)
                            conn.send(JSON.stringify(data));
                    });
                }
            });
        });
    }

    DataDir.init().forEach(function(entry) {
        that.processMessage({type: rjs.MESSAGE_INDEX, file: entry.file});
    });
}

Daemon.prototype._findReferences = function(symbol) {
    var scopes = this.db[symbol.location.file].scopes;
    console.log("CONSIDERING SCOPES", symbol, scopes.length);
    for (let i=0; i<scopes.length; ++i) {
        if (i == symbol.scopeIndex || scopes[i].parentScopes.indexOf(symbol.scopeIndex) != -1) {
            console.log("COOL SCOPE", i, symbol.scopeIndex, scopes[i].parentScopes);
        }
    }
    // gotta resolve target, targets need to
    // console.log(symbol);
};

Daemon.prototype.processMessage = function(msg, sendFunc) {
    var that = this;
    var f;
    var msgType;
    function send(obj) {
        if (sendFunc) {
            if (!obj.error)
                obj.error = rjs.ERROR_OK;
            if (typeof msgType !== 'undefined')
                obj.type = msgType;
            sendFunc(obj);
            log.verboseLog('sending', obj);
        }
    }

    log.verboseLog('got message', msg);
    if (!msg) {
        send({error: rjs.ERROR_PROTOCOL_ERROR});
        return;
    }
    msgType = msg.type;
    switch (msg.type) {
    case rjs.MESSAGE_INDEX:
        var fileName = msg.file;
        msg = undefined;
        if (!fileName) {
            send({error: rjs.ERROR_MISSING_FILE});
            return;
        }
        if (that.db[fileName]) {
            var stat = safe.fs.statSync(fileName);
            if (!stat) {
                send({error: rjs.ERROR_STATFAILURE});
                return;
            }
            if (stat.mtime <= that.db[fileName].indexTime) {
                send({error: rjs.ERROR_FILE_ALREADY_INDEXED});
                return;
            }
        }
        function onFileModified(file) {
            // var cached = that.db[file];
            log.verboseLog(file, 'was modified');
            // if (!cached) {
            //     FileSystemWatcher.unwatch(file, onFileModified);
            //     return;
            // }
            var stat = safe.fs.statSync(file);
            if (!stat) {
                FileSystemWatcher.unwatch(file, onFileModified);
            }

            for (let f in that.db) {
                if (f.source && f.source.contains(file)) {
                    var cached = that.db[f];
                    log.verboseLog(file, 'comparing mtime', stat.mtime, cached.indexTime);
                    if (stat.mtime > cached.indexTime) {
                        index(f, true);
                    }
                }
            }
        }
        function index(file, fromWatcher) {
            if (that.db[file] && that.db[file].source) {
                that.db[file].source.all().forEach(function(file) {
                    FileSystemWatcher.unwatch(file, onFileModified);
                    delete that.db[file.file];
                });
            }
            // log.log('index', file);
            var start = Date.now();
            var source = Preprocessor.preprocess(file);
            if (!source || !source.code) {
                console.error("Couldn't preprocess", file);
                if (!fromWatcher)
                    send({error: rjs.ERROR_READFAILURE});
                FileSystemWatcher.watch(file, onFileModified);
                return;
            }
            // console.log(source.files);
            // for (let i=0; i<source.code.length; ++i) {
            //     console.log("resolve", i, source.resolve(i).file, source.resolve(i).start);
            // }

            // console.log("resolve", source.resolve(57));
            require('fs').writeFileSync("/tmp/foo.js", source.code);
            source.all().forEach(function(file) {
                FileSystemWatcher.watch(file, onFileModified);
            });

            // console.log(source);
            if (!fromWatcher)
                send({});

            var indexer = new Indexer(source);
            var ret = indexer.index();
            if (!ret) {
                console.error("Couldn't parse file", file);
                return;
            }
            var end = Date.now();
            // console.log(ret.symbolNames);
            log.verboseLog(ret);
            // console.log(JSON.stringify(db, undefined, 4));
            DataDir.add(file);

            var syms = 0;
            var symNames = 0;
            that.db[source.mainFile] = ret;
            syms += ret.symbols.length;
            symNames += ret.symbolNames.length;
            log.log('Indexed', file, 'in', (end - start), 'ms',
                    syms, 'symbols and', symNames, 'symbol names');

            that.db[file].source = source;
        }
        index(fileName, false);
        break;

    case rjs.MESSAGE_FOLLOW_SYMBOL:
    case rjs.MESSAGE_FIND_REFERENCES:
    case rjs.MESSAGE_CURSOR_INFO:
        if (!msg.location || !msg.location.file || !msg.location.offset) {
            log.verboseLog("rjs.ERROR_INVALID_LOCATION");
            send({error: rjs.ERROR_INVALID_LOCATION});
            break;
        }
        if (!that.db[msg.location.file]) {
            log.verboseLog("rjs.ERROR_FILE_NOT_INDEXED");
            send({error: rjs.ERROR_FILE_NOT_INDEXED});
            break;
        }
        var result = that.db[msg.location.file].findSymbol(msg.location.offset);
        if (!result) {
            log.verboseLog("rjs.ERROR_SYMBOL_NOT_FOUND");
            send({error: rjs.ERROR_SYMBOL_NOT_FOUND});
            break;
        }
        function createLocation(loc) {
            return loc ? { file: loc.file, offset: loc.start } : {};
        }
        log.verboseLog('Found symbol', result);
        if (msg.type === rjs.MESSAGE_FOLLOW_SYMBOL) {
            send({ target: createLocation(result.symbol.target) });
        } else if (msg.type === rjs.MESSAGE_CURSOR_INFO) {
            send({ cursorInfo: result.symbol });
        } else {
            var startLoc = result.pos;
            if (!result.symbol.definition && result.symbol.target) {
                var sym = that.db[msg.location.file].findSymbol(result.symbol.target[0]);
                if (sym)
                    result = sym;
            }
            var references = this._findReferences(result.symbol);
            var refs = [];
            if (references) {
                for (let idx=0; idx<result.symbol.references.length - 1; ++idx) { // if the current is the last in the array there's no reason to resort
                    if (result.symbol.references[idx][0] === startLoc) {
                        references = result.symbol.references.slice(idx + 1).concat(result.symbol.references.slice(0, idx + 1));
                        break;
                    }
                }
                references.forEach(function(value) { refs.push(createLocation(value)); });
            }

            send({ references: refs });
        }
        break;

    case rjs.MESSAGE_FIND_SYMBOL:
        if (!msg.symbolName) {
            send({error: rjs.ERROR_MISSING_SYMBOLNAME});
            break;
        }

        var locations = [];
        function addLocations(file) {
            var ret = that.db[file].findSymbolsByName(msg.symbolName);
            if (ret) {
                for (let i=0; i<ret.locations.length; ++i) {
                    locations.push({ file: file, offset: ret.locations[i][0] });
                }
            }
        }
        if (msg.file) {
            if (!that.db[msg.file]) {
                send({error: rjs.ERROR_FILE_NOT_INDEXED});
                break;
            }
            addLocations(msg.file);
        } else {
            for (f in that.db) {
                addLocations(f);
            }
        }
        locations.sort();
        send({ locations: locations });
        break;

    case rjs.MESSAGE_LIST_SYMBOLS:
        var symbolNameObject = {};
        var symbolNameArray = [];
        function listSymbols(db) {
            var ret = db.listSymbols(msg.prefix);
            log.verboseLog('Got results', ret);
            for (let i=0; i<ret.symbolNames.length; ++i) {
                var name = ret.symbolNames[i];
                if (!symbolNameObject[name]) {
                    symbolNameObject[name] = true;
                    symbolNameArray.push(name);
                }
            }
        }
        if (msg.file) {
            if (!that.db[msg.file]) {
                send({error: rjs.ERROR_FILE_NOT_INDEXED});
                break;
            }
            listSymbols(that.db[msg.file]);
        } else {
            for (f in that.db) {
                listSymbols(that.db[f]);
            }
        }
        symbolNameArray.sort();
        send({ symbolNames: symbolNameArray });
        break;

    case rjs.MESSAGE_DUMP:
        if (msg.file) {
            if (!that.db[msg.file]) {
                send({error: rjs.ERROR_FILE_NOT_INDEXED});
                break;
            }
            send({ dump: JSON.stringify(that.db[msg.file], null, 4) });
        } else {
            var objects = {};
            var empty = true;
            for (let ff in that.db) {
                empty = false;
                objects[ff] = that.db[ff].indexTime;
            }
            if (!empty) {
                send({ dump: JSON.stringify(objects) });
            } else {
                send({});
            }
        }
        break;
    case rjs.MESSAGE_ERROR:
        send({error: rjs.ERROR_BAD_COMMAND, text: msg.error});
        break;
    default:
        send({error: rjs.ERROR_UNKNOWN_COMMAND});
        break;
    }
};

module.exports = Daemon;
