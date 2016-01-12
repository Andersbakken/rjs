/*global require, module */

function preprocess(file) {
    var fs = require('fs');
    var path = require('path');

    var fileCache = {};
    function load(path) {
        if (fileCache.hasOwnProperty(path))
            return fileCache[path];
        var contents = fs.readFileSync(path, { encoding: 'utf8' });
        fileCache[path] = contents;
        return contents;
    }

    function process(file) {
        file = path.resolve(file);
        // console.log("processing " + file);
        var src = load(file);
        var idx = -1, last = 0;
        var ret = {
            files: [],
            code: ""
        };
        function next() {
            while (true) {
                idx = src.indexOf('// include "', idx + 1);
                if (idx === -1)
                    return undefined;
                if (idx && src[idx - 1] != '\n') {
                    continue;
                }
                var newline = src.indexOf('\n', idx);
                if (newline == -1) {
                    idx = -1;
                    return undefined;
                }

                var quote = src.indexOf('"', idx + 12);
                if (quote >= newline) {
                    continue;
                }
                var includedFile = src.substring(idx + 12, quote);
                idx = newline + 1;
                return includedFile;
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
            data.files.forEach(function(entry) {
                entry.index += (idx + added);
                ret.files.push(entry);
            });
            ret.code += data.code;
            added += data.code.length;
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

function resolveLocation(idx, files) {
    for (var i=0; i<files.length; ++i) {
        if (idx < files[i].length)
            return { file: files[i].file, index: idx };
        idx -= files[i].length;
    }
    return undefined;
}

module.exports = {
    preprocess: preprocess,
    resolveLocation: resolveLocation
};
