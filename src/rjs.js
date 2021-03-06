/*global safe, module, require */

'use strict';

module.exports = (function() {
    var safe = require('safetydance');
    var path = require('path');
    var defPort = 5678;
    var expandTilde = require('expand-tilde');

    return {
        // errors
        ERROR_OK: 'ok',
        ERROR_READFAILURE: 'read failure',
        ERROR_PARSE_FAILURE: 'parse failure',
        ERROR_MISSING_FILE: 'missing file',
        ERROR_PROTOCOL_ERROR: 'protocol error',
        ERROR_FILE_ALREADY_INDEXED: 'file already indexed',
        ERROR_INVALID_LOCATION: 'invalid location',
        ERROR_FILE_NOT_INDEXED: 'file not indexed',
        ERROR_SYMBOL_NOT_FOUND: 'symbol not found',
        ERROR_MORE_DATA: 'more data',
        ERROR_STATFAILURE: 'stat failure',
        ERROR_MISSING_SYMBOLNAME: 'missing symbolname',
        ERROR_UNKNOWN_COMMAND: 'unknown command',

        MESSAGE_INDEX: 'index',
        MESSAGE_FOLLOW_SYMBOL: 'follow-symbol',
        MESSAGE_FIND_REFERENCES: 'find-references',
        MESSAGE_DUMP: 'dump',
        MESSAGE_CURSOR_INFO: 'cursor-info',
        MESSAGE_FIND_SYMBOLS: 'find-symbol',
        MESSAGE_LIST_SYMBOLS: 'list-symbols',
        MESSAGE_LOG: 'log',
        MESSAGE_ERROR: 'error',
        MESSAGE_UNINDEX: 'unindex',

        defaultPort: defPort,

        context: function context(loc, fileCache) {
            var contents;
            if (fileCache)
                contents = fileCache[loc.file];

            if (!contents) {
                contents = safe.fs.readFileSync(loc.file, { encoding: 'utf8' });
                if (contents && fileCache) {
                    fileCache[loc.file] = contents;
                }
            }
            if (contents && contents.length > loc.offset) {
                var prevNewLine = contents.lastIndexOf('\n', loc.offset) + 1;
                var nextNewLine = contents.indexOf('\n', loc.offset);
                if (nextNewLine == -1)
                    nextNewLine = contents.length;
                return contents.substring(prevNewLine, nextNewLine - 1);
            }
            return undefined;
        },

        printLocation: function printLocation(options) {
            var loc = options.location;
            if (!(loc instanceof Object) || typeof loc.file != 'string' || typeof loc.offset != 'number') {
                return undefined;
            }
            var header = options.header;
            var fileCache = options.fileCache;
            var showContext = options.showContext;
            // console.log('options', options);
            var out = (header || '') + loc.file + ',' + loc.offset;
            if (showContext) {
                var context = this.context(loc, options.fileCache);
                if (context)
                    out += '\t' + context;
            }
            return out;
        },
        createLocation: function createLocation(fileAndOffset) {
            var caps = /(.*),([0-9]+)?/.exec(fileAndOffset);
            // var caps = /(.*):([0-9]+):([0-9]+):?/.exec(fileAndLine);
            if (!caps) {
                console.error('Can\'t parse location', fileAndOffset);
                return undefined;
            }
            var file = expandTilde(caps[1]);
            var stat = safe.fs.statSync(file);
            if (!stat || !stat.isFile()) {
                console.error(caps[1], 'doesn\'t seem to be a file');
                return undefined;
            }
            file = path.resolve(file);
            // return { file: caps[1], line: caps[2], column: caps[3] };
            return { file: file, offset: caps[2] };
        },
        createCommands: function(parsed)
        {
            var commands = [];
            var file = parsed['file'];
            var rjs = this;
            function add(arg) {
                function createCommand(value) {
                    var cmd;
                    switch (arg) {
                    case 'index':
                        if (typeof value != 'string') {
                            cmd = { type: rjs.MESSAGE_ERROR, error: '--index needs an argument' };
                            break;
                        }
                        value = expandTilde(value);
                        var stat = safe.fs.statSync(value);
                        if (!stat || !stat.isFile()) {
                            cmd = { type: rjs.MESSAGE_ERROR, error: value + ' does not seem to be a file' };
                            break;
                        }

                        cmd = { type: rjs.MESSAGE_INDEX, file: path.resolve(value) };
                        break;
                    case 'unindex':
                        if (typeof value != 'string') {
                            cmd = { type: rjs.MESSAGE_ERROR, error: '--index needs an argument' };
                            break;
                        }
                        value = expandTilde(value);
                        cmd = { type: rjs.MESSAGE_UNINDEX, file: path.resolve(value) };
                        break;
                    case 'log':
                        cmd = { type: rjs.MESSAGE_LOG, verbose: parsed.verbose };
                        break;
                    case 'follow-symbol':
                        cmd = { type: rjs.MESSAGE_FOLLOW_SYMBOL, location: rjs.createLocation(value) };
                        break;
                    case 'find-references':
                        cmd = { type: rjs.MESSAGE_FIND_REFERENCES, location: rjs.createLocation(value) };
                        break;
                    case 'dump':
                        cmd = { type: rjs.MESSAGE_DUMP };
                        break;
                    case 'dump-file':
                        if (typeof value != 'string') {
                            cmd = { type: rjs.MESSAGE_ERROR, error: '--dump-file needs an argument' };
                            break;
                        }
                        value = expandTilde(value);
                        var dstat = safe.fs.statSync(value);
                        if (!dstat || !dstat.isFile()) {
                            cmd = { type: rjs.MESSAGE_ERROR, error: value + ' does not seem to be a file' };
                            break;
                        }

                        cmd = { type: rjs.MESSAGE_DUMP, file: path.resolve(value) };
                        break;
                    case 'cursor-info':
                        cmd = { type: rjs.MESSAGE_CURSOR_INFO, location: rjs.createLocation(value) };
                        break;
                    case 'list-symbols':
                        cmd = { type: rjs.MESSAGE_LIST_SYMBOLS, file: file, prefix: typeof value === 'string' ? value : undefined };
                        break;
                    case 'find-symbol':
                        cmd = { type: rjs.MESSAGE_FIND_SYMBOL, file: file, symbolName: value };
                        break;
                    default:
                        console.error('Invalid command:', arg);
                        break;
                    }

                    commands.push(cmd);
                }
                var val = parsed[arg];
                if (val) {
                    if (val instanceof Array) {
                        val.forEach(function(arg) { createCommand(arg); });
                    } else {
                        createCommand(val);
                    }
                }
            }

            add('index');
            add('unindex');
            add('follow-symbol');
            add('find-references');
            add('dump-file');
            add('cursor-info');
            add('dump');
            add('find-symbol');
            add('list-symbols');
            add('log');
            return commands;
        },
        clientUsageString: ('Usage:\n$0 ...options\n' +
                            '  -c|--index [file]\n' +
                            '  -D|--unindex [file]\n' +
                            '  -f|--follow-symbol [location]\n' +
                            '  -r|--find-references [location]\n' +
                            '  -U|--dump-file [file]\n' +
                            '  -d|--dump\n' +
                            '  -h|--help\n' +
                            '  -u|--cursor-info [location]\n' +
                            '  -N|--no-context\n' +
                            '  -g|--log\n' +
                            '  -h|--help\n' +
                            '  -v|--verbose\n' +
                            '  -F|--find-symbol [symbolName]\n' +
                            '  -S|--list-symbols [optional prefix]\n' +
                            '  -P|--file [file]\n' +
                            '  -p|--port [port] (default ' + defPort + ')\n'),
        clientParseArgsOptions: {
            alias: {
                c: 'index',
                D: 'unindex',
                f: 'follow-symbol',
                r: 'find-references',
                U: 'dump-file',
                d: 'dump',
                h: 'help',
                u: 'cursor-info',
                N: 'no-context',
                v: 'verbose',
                p: 'port',
                g: 'log',
                F: 'find-symbol',
                S: 'list-symbols',
                P: 'file'
            },
            default: {
                p: defPort
            },
            boolean: [
                'dump',
                'no-context',
                'verbose',
                'log',
                'help'
            ]
        },
        elispEscape: function(str) {
            var ret;
            for (let i=0; i<str.length; ++i) {
                var ch = str.charCodeAt(i);
                switch (ch) {
                case 34: // "
                case 92: // \
                case 10: // '\n'
                case 9: // '\t'
                    if (!ret) {
                        if (i) {
                            ret = str.substr(0, i);
                        } else {
                            ret = "";
                        }
                    }
                    switch (ch) {
                    case 34: // '"':
                        ret += '\\"';
                        break;
                    case 10: // '\n':
                        ret += '\\n';
                        break;
                    case 9: // '\t':
                        ret += '\\t';
                        break;
                    case 92:
                        ret += '\\\\';
                        break;
                    }
                    break;
                default:
                    if (ret)
                        ret += str[i]; // ### inefficient, should store last
                    break;
                }
            }
            return ret ? ret : str;
        }

        // responseOutputType: {
        //     XML: "xml",
        //     ELISP: "elisp"
        // },

        // formatResponse: function(response, responseOutputType) {
        // }
    };
})();
