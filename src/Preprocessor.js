/*global require, module */

var SourceCode = require('./SourceCode');
var log = require('./log');
var resolve = require('resolve').sync;

function preprocess(file) {
    var fs = require('fs');
    var path = require('path');

    file = path.resolve(file);
    var cwd = path.dirname(file);

    var fileCache = {};
    function load(p) {
        if (fileCache.hasOwnProperty(p))
            return fileCache[p];
        try {
            var contents = fs.readFileSync(p, { encoding: 'utf8' });
            fileCache[p] = contents;
            return contents;
        } catch (err) {
            log.verboseLog("Couldn't load file: " + err.toString());
            return undefined;
        }
    }

    function process(file) {
        file = path.resolve(cwd, file);
        log.verboseLog("processing", file, cwd);
        var src = load(file);
        if (src === undefined)
            return undefined;
        var idx = -1, last = 0;
        var ret = new SourceCode(file);
        function next() {
            function findInclude(index, best) {
                while (true) {
                    index = src.indexOf('// include "', index + 1);
                    if (index === -1 || best >= 0 && index > best)
                        return undefined;
                    if (index && src[index - 1] != '\n') {
                        continue;
                    }
                    var newline = src.indexOf('\n', index);
                    if (newline == -1) {
                        index = -1;
                        return undefined;
                    }

                    var quote = src.indexOf('"', index + 12);
                    if (quote >= newline) {
                        continue;
                    }
                    var includedFile = src.substring(index + 12, quote);
                    return { file: includedFile, index: index, next: newline + 1 };
                }
            }

            function findRequire(index, best) {
                while (true) {
                    index = src.indexOf("require", index + 1);
                    // var match[0] = src.indexOf(/require *\\( *[']([^']+)['] *)/, index + 1);
                    if (index == -1 || best >= 0 && index > best)
                        return undefined;

                    if (index == 0) {
                        // you can't really have require as the first word in your file
                        continue;
                    }

                    var newline = src.indexOf('\n', index);
                    if (newline == -1) {
                        index = -1;
                        return undefined;
                    }

                    var sub = src.substring(index - 1, newline - 1);

                    var match = /\brequire *\([ \t]*'([^']+)'[\t ]*\)/.exec(sub);
                    if (!match)
                        match = /\brequire *\([ \t]*"([^"]+)"[\t ]*\)/.exec(sub);
                    if (!match)
                        continue;

                    var resolved;
                    try {
                        resolved = resolve(match[1], { basedir: cwd + '/' });
                    } catch (err) {
                        log.verboseLog("Couldn't resolve require ", err.toString());
                        continue;
                    }

                    return { file: resolved, index: index, next: newline + 1 };
                }
            }
            var inc = findInclude(idx, -1);
            var req = findRequire(idx, inc ? inc.index : -1);
            if (inc && req) {
                if (inc.index < req.index) {
                    idx = inc.next;
                    return inc.file;
                } else {
                    idx = req.next;
                    return req.file;
                }
            } else if (inc) {
                idx = inc.next;
                return inc.file;
            } else if (req) {
                idx = req.next;
                return req.file;
            } else {
                return undefined;
            }
        }

        var added = 0;
        while (true) {
            var included = next();
            if (!included)
                break;
            if (idx > last) {
                ret.files.push({ index: last + added, length: idx - last, file: file });
                ret.code += src.substring(last, idx);
                last = idx;
            }
            var data = process(included);
            if (data) {
                data.files.forEach(function(entry) {
                    entry.index += (idx + added);
                    ret.files.push(entry);
                });
                ret.code += data.code;
                added += data.code.length;
            }
        }
        if (ret.files.length == 0) {
            ret.code = src;
            ret.files.push({ index: 0, length: src.length, file: file });
        } else if (last < src.length) {
            ret.code += src.substr(last);
            ret.files.push({ index: last + added, length: src.length - last, file: file });
        }

        return ret;
    }
    return process(file);
}

module.exports = {
    preprocess: preprocess,
    SourceCode: SourceCode
};
