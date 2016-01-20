/*global require, module */

var SourceCode = require('./SourceCode');
var log = require('./log');
var resolve = require('resolve').sync;

function neuterPreprocessingStatements(code)
{
    var ret = "";
    var last = 0;
    function processLine(from, to) {
        if (from > last) {
            ret += code.substring(last, from);
        }
        if (to < 0) {
            last = to = code.length - 1;
        } else {
            last = to + 1;
        }
        var spaces = "";
        while (from++ < to)
            spaces += ' ';
        ret += spaces;
        return last;
    }

    var idx = 0;
    if (code.charCodeAt(0) == 35) {
        idx = processLine(0, code.indexOf('\n') - 1); // not handling single line files
    }

    while (true) {
        idx = code.indexOf('\n#', idx);
        if (idx == -1)
            break;
        idx = processLine(idx + 1, code.indexOf('\n', idx + 1) - 1);
    }

    if (last == 0)
        return code;
    if (last < code.length - 1)
        ret += code.substring(last);
    return ret;
}

function preprocess(file) {
    var fs = require('fs');
    var path = require('path');

    file = path.resolve(file);
    var cwd = path.dirname(file);

    var seen = {};
    function load(p) {
        try {
            var contents = fs.readFileSync(p, { encoding: 'utf8' });
            return contents;
        } catch (err) {
            log.log("Couldn't load file: " + err.toString());
            return undefined;
        }
    }

    function process(file) {
        file = path.resolve(cwd, file);
        log.verboseLog("processing", file, cwd);
        if (seen[file]) {
            log.verboseLog(file + ' has already been included');
            return undefined;
        }
        seen[file] = true;
        var src = load(file);
        if (src === undefined)
            return undefined;
        var idx = -1, last = 0;
        var ret = new SourceCode(file);
        function next() {
            function findInclude(index, best) {
                var oldold = index;
                while (true) {
                    var old = index;
                    index = src.indexOf('// #include "', index);
                    if (index === -1 || (best >= 0 && index > best)) {
                        return undefined;
                    }

                    if (index && src[index - 1] != '\n') {
                        continue;
                    }
                    var newline = src.indexOf('\n', index);
                    if (newline == -1) {
                        return undefined;
                    }

                    var quote = src.indexOf('"', index + 13);
                    if (quote >= newline) {
                        continue;
                    }
                    var includedFile = src.substring(index + 13, quote);
                    return { file: includedFile, index: index, next: newline };
                }
            }

            function findRequire(index, best) {
                while (true) {
                    index = src.indexOf("require", index + 1);
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

                    return { file: resolved, index: index, next: index + match[0].length };
                }
            }
            var inc = findInclude(idx + 1, -1);
            var req = findRequire(idx + 1, inc ? inc.index : -1);
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
            if (!included) {
                break;
            }
            var data = process(included);
            if (data) {
                if (idx > last) {
                    ret.files.push({ index: last + added, length: idx - last + 1, file: file });
                    ret.code += src.substring(last, idx + 1);
                    // console.log("ADDING", idx + 1 - last, "FROM a.js");
                    last = idx;
                }
                data.files.forEach(function(entry) {
                    entry.index += (idx + added + 1);
                    ret.files.push(entry);
                });
                ret.code += data.code;
                // console.log("ADDING", data.code.length, "FROM b.js");
                added += data.code.length;
            }
        }
        if (ret.files.length == 0) {
            ret.code = src;
            ret.files.push({ index: 0, length: src.length, file: file });
        } else if (last < src.length) {
            ret.code += src.substr(last + 1);
            // console.log("ADDING", src.substr(last).length, "FROM a.js");
            ret.files.push({ index: last + added + 1, length: src.length - last, file: file });
        }

        return ret;
    }
    var ret = process(file);
    if (ret) {
        ret.code = neuterPreprocessingStatements(ret.code);
    }
    return ret;
}

// var src = preprocess("/Users/abakken/dev/nrdp/16.1/src/nrd/NBP/bridge/nrdp.js");
// console.log(src.files);
// require('fs').writeFileSync("/tmp/foo.js", src.code);
// console.log(src.code);
// process.exit();

module.exports = {
    preprocess: preprocess
};
