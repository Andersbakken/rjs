#!/usr/bin/env node

/*global require, process*/

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

function processMessage(msg, sendFunc) {
    var msgType;
    function send(obj) {
        if (!obj.error)
            obj.error = rjs.ERROR_OK;
        if (typeof msgType !== 'undefined')
            obj.type = msgType;
        sendFunc(obj);
        if (verbose)
            console.log("sending", obj);
    }

    if (verbose) {
        console.log("got message", msg);
    } else if (msg instanceof Object) {
        console.log("got message", msg.type);
    }
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
        function index(output) {
            console.log("index", fileName);
            var start = new Date();
            var source = safe.fs.readFileSync(fileName, { encoding:'utf8' });
            var indexTime = new Date();
            if (!source) {
                console.error("Couldn't open", fileName, "for reading");
                if (output)
                    send({error: rjs.ERROR_READFAILURE});
                return false;
            }
            if (output)
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
        if (index(true)) {
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
                    index(false);
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
            return loc ? { file: msg.location.file, offset: loc[0] } : {};
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
            var refs = [];
            if (references) {
                for (var idx=0; idx<result.symbol.references.length - 1; ++idx) { // if the current is the last in the array there's no reason to resort
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
}

server.on('connection', function(conn) {
    if (verbose)
        console.log("Got a connection");
    conn.on('close', function(message) {
        conn = undefined;
    });
    conn.on('message', function(message) {
        processMessage(safe.JSON.parse(message), function(data) {
            if (conn)
                conn.send(JSON.stringify(data));
        });
    });
});

var parseArgsOptions = {
    alias: {
        c: 'compile',
        f: 'follow-symbol',
        r: 'find-references',
        U: 'dump-file',
        d: 'dump',
        u: 'cursor-info',
        N: 'no-context',
        F: 'find-symbols',
        S: 'list-symbols',
        P: 'file'
    },
    boolean: [ 'dump', 'no-context', 'verbose' ]
};

var pendingStdIn = '';
process.stdin.on('readable', function() {
    var read = process.stdin.read();
    if (!read)
        return;
    pendingStdIn += read;
    var lines = pendingStdIn.split('\n');
    if (lines.length > 1) {
        for (var i=0; i<lines.length - 1; ++i) {
            var commands;
            if (lines[i][0] === '-') {
                var parsed = parseArgs(lines[i].split(/ +/), parseArgsOptions);
                commands = rjs.createCommands(parsed);
            } else {
                commands = [safe.JSON.parse(lines[i])];
            }

            commands.forEach(function(msg) {
                processMessage(msg, function(response) {
                    function write(func) {
                        console.log("<results><![CDATA[");
                        if (func instanceof Function) {
                            func();
                        } else {
                            console.log(func);
                        }
                        console.log("]]></results>");
                    }
                    if (response.target) {
                        write(rjs.printLocation({location:response.target}));
                    } else if (response.references || response.locations) {
                        write(function() {
                            var locs = response.references || response.locations;
                            var fileCache = {};
                            locs.forEach(function(loc) {
                                console.log(rjs.printLocation({location: loc, showContext: true, fileCache: fileCache }));
                            });
                        });
                    } else if (response.dump) {
                        write(response.dump);
                    } else if (response.cursorInfo) {
                        write(function() {
                            console.log(rjs.printLocation({location: response.cursorInfo.location}));
                            console.log('Name:',
                                        response.cursorInfo.name,
                                        response.cursorInfo.definition ? 'Definition' : 'Reference');
                            if (response.cursorInfo.references && response.cursorInfo.references.length) {
                                console.log('References:');
                                response.cursorInfo.references.forEach(function(loc) {
                                    console.log(rjs.printLocation({location: loc, header: '  ', fileCache: fileCache, showContext: true }));
                                });
                            }
                        });
                    } else if (response.symbolNames) {
                        write(function() {
                            response.symbolNames.forEach(function(name) { console.log(name); });
                        });
                    } else if (response.type != rjs.MESSAGE_COMPILE) {
                        console.error("Unknown response", response);
                    }
                });
            });
        }
        pendingStdIn = lines[lines.length - 1] || '';
    }
});
