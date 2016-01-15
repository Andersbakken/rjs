/*global require, module */
var esprima = require('esprima');
var esrefactor = require('esrefactor');
var estraverse = require('estraverse');
var bsearch = require('./bsearch');
var Database = require('./Database');
var Location = require('./Location');

function indexFile(code, file, verbose)
{
    var REFERENCE = 5;
    var MAYBE_REFERENCE = 3;
    var DEFINITION = 0;
    if (code.lastIndexOf("#!", 0) === 0) {
        var ch = 0;
        var header = "";
        while (ch < code.length && code.charCodeAt(ch) !== 10) {
            ++ch;
            header += " ";
        }
        code = header + code.substring(ch);
        // console.log("replaced", ch);
    }
    var esrefactorContext = new esrefactor.Context();
    var parsed;
    try {
        parsed = esprima.parse(code, { tolerant: true, range: true });
    } catch (err) {
        console.log("Got error", err, "for", code);
        return new Database(file, undefined, undefined, [err]);
    }

    if (!parsed)
        throw new Error("Couldn't parse file " + file + ' ' + code.length);

    esrefactorContext.setCode(parsed);
    if (!esrefactorContext._syntax)
        throw new Error('Unable to identify anything without a syntax tree');

    var parents = [];

    // console.log("BALLS", JSON.stringify(parsed, null, 4));

    function codeForLocation(range)
    {
        return code.substring(range[0], range[1]);
    }
    function childKey(child) // slow
    {
        var p = child.parent;
        for (var key in p) {
            if (p[key] === child) {
                return key;
            }
        }
        return "not found";
    }
    function isChild(key, node)
    {
        if (!node)
            node = parents[parents.length - 1];

        if (node.parent) {
            var p = node.parent[key];
            if (p !== undefined) {
                if (p instanceof Array) {
                    return p.indexOf(node) != -1;
                } else {
                    return p == node;
                }
            }
        }
        return false;
    }

    var scopes = [];
    var scopeStack = [];

    function qualifiedName(node)
    {
        if (!node)
            node = parents[parents.length - 1];
        var orig = node;
        var seen = [];
        function resolveName(n)
        {
            if (seen.indexOf(n) != -1)
                return undefined;
            seen.push(n);
            if (n) {
                switch (n.type) {
                case esprima.Syntax.Identifier:
                    return n.name;
                case esprima.Syntax.Literal:
                    return n.value;
                case esprima.Syntax.MemberExpression:
                    if (seen.indexOf(n.object) != -1 || seen.indexOf(n.property) != -1)
                        break;
                    return resolveName(n.object) + "." + resolveName(n.property);
                case esprima.Syntax.ObjectExpression:
                case esprima.Syntax.Property:
                    return resolveName(n.key);
                case esprima.Syntax.VariableDeclarator:
                case esprima.Syntax.FunctionDeclaration:
                    return resolveName(n.id);
                case esprima.Syntax.AssignmentExpression:
                    return resolveName(n.left);
                case esprima.Syntax.CallExpression:
                    return resolveName(n.callee);
                default:
                    break;
                    // console.log("Not sure how to resolve", node.type, node.range);
                }
            }
            return undefined;
        }

        var name = undefined;
        var prev = undefined;
        while (node) {
            if (node.type) {
                var done = false;
                switch (node.type) {
                case esprima.Syntax.FunctionExpression:
                case esprima.Syntax.FunctionDeclaration:
                case esprima.Syntax.CallExpression:
                    done = prev;
                    break;
                case esprima.Syntax.AssignmentExpression:
                    done = prev && (prev.type != esprima.Syntax.ObjectExpression || node.right != prev);
                    // if (done)
                    //     console.log("Stopping", orig.range, "at", name, "because of", node.type);
                    break;
                case esprima.Syntax.VariableDeclarator:
                    done = prev && prev.type != esprima.Syntax.ObjectExpression && isChild("init", prev);
                    // if (done)
                    //     console.log("Stopping", orig.range, "at", name, "because of VariableDeclarator");
                    break;
                case esprima.Syntax.MemberExpression:
                    done = node.computed;
                    break;
                default:
                    break;
                }
                if (done)
                    break;

                var n = resolveName(node);
                if (n) {
                    if (!name) {
                        name = n;
                    } else {
                        name = n + "." + name;
                    }
                }
                prev = node;
                node = node.parent;
            }
        }
        return name;
    }

    function indexIdentifier(node)
    {
        node.indexed = true;
        var rank = MAYBE_REFERENCE;
        var name = undefined;
        switch (node.parent.type) {
        case esprima.Syntax.VariableDeclarator:
            if (isChild("init")) {
                rank = REFERENCE;
            } else {
                rank = DEFINITION;
            }
            break;
        case esprima.Syntax.FunctionDeclaration:
        case esprima.Syntax.FunctionExpression:
        case esprima.Syntax.Property:
        case esprima.Syntax.CatchClause:
            // ### the Identifier for the catch clause should strictly
            // ### speaking be a scope of its own but only for that one
            // ### variable. Not handled right now
            rank = DEFINITION;
            break;
        case esprima.Syntax.AssignmentExpression:
            rank = MAYBE_REFERENCE;
            break;
        case esprima.Syntax.CallExpression:
        case esprima.Syntax.UnaryExpression:
        case esprima.Syntax.BinaryExpression: // ### ???
        case esprima.Syntax.ReturnStatement:
        case esprima.Syntax.NewExpression:
        case esprima.Syntax.UpdateExpression:
        case esprima.Syntax.ForInStatement:
        case esprima.Syntax.IfStatement:
        case esprima.Syntax.WhileStatement:
        case esprima.Syntax.DoWhileStatement:
        case esprima.Syntax.ForStatement:
        case esprima.Syntax.LogicalExpression:
        case esprima.Syntax.ConditionalExpression:
        case esprima.Syntax.ArrayExpression:
            rank = REFERENCE;
            break;
        case esprima.Syntax.MemberExpression:
            if (isChild("property", node))
                name = qualifiedName(node.parent);
            rank = (node.parent.parent.type == esprima.Syntax.AssignmentExpression ? MAYBE_REFERENCE : REFERENCE);
            break;
        default:
            // console.log("Shit", node.type);
            console.log("Unhandled parent", node.parent.type, node.parent.range, codeForLocation(node.parent.range),
                        node.range, codeForLocation(node.range));
            break;
        }
        if (name === undefined)
            name = qualifiedName();
        // console.log("  Found identifier", name, node.range, node.type, rank);
        name += '_';
        node.range.push(rank);
        var scope = scopeStack[scopeStack.length - 1];
        if (scope.objects[name]) {
            scope.objects[name].push(node.range);
        } else {
            scope.objects[name] = [node.range];
        }
        ++scope.count;
    }

    estraverse.traverse(esrefactorContext._syntax, {
        enter: function (node) {
            if (parents.length)
                node.parent = parents[parents.length - 1];
            parents.push(node);
            // console.log("entering", node.type, childKey(node));
            switch (node.type) {
            case esprima.Syntax.Program:
            case esprima.Syntax.FunctionExpression:
                node.scope = true;
                break;
            case esprima.Syntax.FunctionDeclaration:
                node.id.parent = node;
                indexIdentifier(node.id);
                node.scope = true;
                break;
            case esprima.Syntax.Identifier:
                if (!node.indexed) {
                    // we need to handle the function itself as part of the previous scope
                    indexIdentifier(node);
                }
                break;
            default:
                break;
            }
            if (node.scope) {
                var scope = { objects: {}, count: 0, type: node.type, index: scopes.length, defs: {}, range: node.range };
                scopeStack.push(scope);
                // console.log("adding a scope", node.type, node.range);
                scopes.push(scope);
            }
        },
        leave: function (node) {
            parents.pop();
            if (node.scope) {
                var scope = scopeStack.pop();
                // console.log("popping a scope", scope.type, scope.range);
                scope.scopeStack = [];
                for (var i=0; i<scopeStack.length; ++i) {
                    scope.scopeStack.push(scopeStack[i].index);
                }
            }
        }
    });

    var symbolNames = {};
    var ret = new Database(file);
    function add(name, scope) {
        var locations = scope.objects[name];
        // console.log("    add", name, locations, scope.index, scope.scopeStack);
        if (!symbolNames[name]) {
            symbolNames[name] = locations;
        } else {
            symbolNames[name] = symbolNames[name].concat(locations);
        }

        var i;
        var defObj;
        var newDef = false;
        if (locations[0][2] !== REFERENCE) {
            defObj = { location: locations[0], definition: true, name: name.slice(0, -1), references: [] };
            newDef = true;
        }
        if (locations[0][2] === DEFINITION) {
            scope.defs[name] = defObj;
        } else { // not a perfect hit, we need to search parent scopes
            for (var idx=scope.scopeStack.length - 1; idx>=0; --idx) {
                var parentScope = scopes[scope.scopeStack[idx]];
                var def = parentScope.defs[name];
                if (def && (!defObj || def.location[2] === DEFINITION)) {
                    newDef = false;
                    defObj = def;
                    break;
                }
            }
        }
        if (newDef) {
            scope.defs[name] = defObj;
            ret.symbols.push(defObj);
            i = 1;
        } else {
            i = 0;
        }
        while (i < locations.length) {
            var loc = locations[i];
            var obj = { location: loc, name: name };
            if (defObj) {
                defObj.references.push(loc.slice());
                obj.target = defObj.location.slice();
            }
            // console.log("REALLY ADDING AN OBJECT", obj);
            ret.symbols.push(obj);
            ++i;
        }
    }
    for (var s=0; s<scopes.length; ++s) {
        var scope = scopes[s];
        // console.log(JSON.stringify(scope));
        // continue;
        // console.log("Adding things for scope", s, scope.count, scopes.length, scope.type, scope.range);
        if (scope.count) {
            for (var name in scope.objects) {
                scope.objects[name].sort(function(l, r) {
                    var ret = l[2] - r[2];
                    if (!ret)
                        ret = l[0] - r[0];
                    return ret;
                });
                add(name, scope);
            }
        }
    }
    ret.symbols.sort(function(l, r) {
        var ret = l.location[0] - r.location[0];
        if (!ret)
            ret = l.location[1] - r.location[1];
        return ret;
    });

    for (var symbolName in symbolNames) {
        ret.symbolNames.push({ name: symbolName.substr(0, symbolName.length - 1),
                               locations: symbolNames[symbolName] });
    }

    ret.symbolNames.sort(function(l, r) { return l.name.localeCompare(r.name); });

    if (verbose >= 2) {
        estraverse.traverse(esrefactorContext._syntax, {
            enter: function(node) {
                delete node.parent;
                delete node.indexed;
            }
        });
        ret.ast = esrefactorContext._syntax;
    }
    if (esrefactorContext._syntax.errors)
        ret.errors = esrefactorContext._syntax.errors;
    // console.log(file, "indexed");
    return ret;
}

module.exports = indexFile;
