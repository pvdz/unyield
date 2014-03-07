// TODO parseCompleteBlock might fail..? (try/catch/finally, not even sure how they work at all) and funcexpr
// TODO labels are gonna crash
// TODO break, continue
// TODO confirm break/continue in a loop
// TODO break in switch will crash
// TODO in fact, switch will crash
// TODO break;yield; translating weirdly

function yieldify(input) {
  var prefix = '_\u03b3_';
  var p = Par.parse(input, {saveTokens:true,createBlackStream:true});
  var wlist = p.tok.tokens;
  var blist = p.tok.black;

  for (var i=0; i<blist.length; ++i) {
    var token = blist[i];
    if (token.isVarToken) {
      if (token.isForEach) {
        // for (ONE;TWO;THREE) x;
        // for (ONE;TWO;THREE) { x; }
        // - put ONE before `for`
        // - put TWO inside header
        // - put THREE at the end of for-statement
        // ONE;for(TWO) { x; THREE; }

        var start = token.lhp.white; // skip `for(`
        var semi1 = token.semi1.white;
        var semi2 = token.semi2.white;
        var end = token.rhp.white;

        var one = wlist.slice(start+1, semi1).map(function(o){ var v = o.value;o.value = ''; return v; }).join('');
        wlist[semi1].value = '';
        var two = wlist.slice(semi1+1, semi2).some(function(o){ return o.black; });
        wlist[semi2].value = '';
        var three = wlist.slice(semi2+1, end).map(function(o){ var v = o.value;o.value = ''; return v; }).join('');

        token.value = '{'+one+';'+'while';
        if (!two) token.lhp.value += 'true';
        var target = blist[token.stmtEnd.black-1];
        if (blist[token.rhp.black+1].value === '{') {
          target.value = three+';}'+target.value;
        } else {
          token.rhp.value += '{';
          token.stmtEnd.value = token.stmtEnd.value+(token.stmtEnd.value===';'?'':';')+three+';}}';
        }

        i = token.rhp.white;
      } else if (token.isForIn) {
        // for (var key in (rhs)) stmt
        // for ((lhs) in (expr)) stmt

        // https://gist.github.com/qfox/9121615
        // for token has .inToken and .lhp .rhp, so we can just slice them out
        // we could re-use the var if any, but let's leave that for the v2 :)

        var lhp = token.lhp.white;
        var inw = token.inToken.white;
        var rhp = token.rhp.white;


        token.value = '';
        wlist[lhp].value = '';
        if (blist[token.lhp.black+1].value === 'var') {
          // drop `var` to make sure lhs is expression
          var useVar = true;
          blist[token.lhp.black+1].value = '';
        }
        var lhs = wlist.slice(lhp+1, inw).map(function(o){ var v = o.value; o.value = ''; return v; }).join('');
        wlist[inw].value = '';
        var rhs = wlist.slice(inw+1, rhp).map(function(o){ var v = o.value; o.value = ''; return v; }).join('');
        wlist[rhp].value = '';

        token.value =
          (useVar?'var':'')+lhs+';\n'+
            'var '+prefix+'key, '+prefix+'keys = [], '+prefix+'expro = ('+rhs+'), '+prefix+'tkey;\n'+
            'for ('+prefix+'key in '+prefix+'expro) '+prefix+'keys.push('+prefix+'key);\n'+
            'while ('+prefix+'keys.length)\n' +
            'if (' +
            prefix+'expro.hasOwnProperty('+prefix+'tkey = '+prefix+'keys.shift())' +
            // this looks a big convoluted but prevents us having to block-wrap the statement :)
            ' && !void('+lhs+' = '+prefix+'tkey)' +
            ')\n';
        // original statement goes here, should still work as before
      } else {
        console.warn('unknown for-loop?');
      }
    } else if (token.isDo) {
      // fairly simple
      // do block while (exprs);
      // block while(exprs) block

      // we dont need the `do` anymore. we'll need to wrap the result in a block though
      token.value = '{';
      // leave block as is. we'll _copy_ it after the while too
      var block = wlist.slice(token.lhc.white, token.rhc.white).map(function(o){ return o.value; }).join('');
      // replace the _mandatory_ semi token with the block value
      blist[token.rhp.black+1].value = block +
        // and close the outer-block to make sure the whole thing remains one statement
        '}';
    }
  }

  var processedInput = wlist.map(function(o){ return o.value; }).join('');

  // TODO: if (foo) { yield x; } will break the block
  var p = Par.parse(processedInput, {saveTokens:true,createBlackStream:true});

  var wlist = p.tok.tokens;
  var blist = p.tok.black;

  var yields = [];
  for (var i=0, len=blist.length; i<len; ++i) {
    var token = blist[i];
    if (token.isYield) {
      yields.push(token);
    }
  }

  for (i=0, len=yields.length; i<len; ++i) {
    var currentYield = yields[i];
    var func = currentYield.funcToken;
//    console.log(currentYield);
    // we will slice out the yield+expr
    // [A        [B   C]       D]
    // [stmstart [yield] stmtend]
    var stmtStart = currentYield.statementStart.white;
    var yieldStart = currentYield.white;
    var yieldEnd = currentYield.exprEnd.white;
    var stmtEnd = currentYield.statementStart.statementEnd.white;

    if (blist[func.black+1].value === '*') blist[func.black+1].value = '';

    var yieldExprPart = wlist.slice(yieldStart+1, yieldEnd);
    var yieldExpr = yieldExprPart.map(function(o){ var v = o.value;o.value = ''; return v; }).join('');
    currentYield.value = prefix+'yieldValue';
    var yieldStmtPart = wlist.slice(stmtStart, stmtEnd);
    var yieldStmt = yieldStmtPart.map(function(o){ var v = o.value; o.value = ''; return v; }).join('');

//    console.log('expr:', [yieldExpr, yieldStart, yieldEnd]);
//    console.log('stmt:', [yieldStmt, stmtStart, stmtEnd]);

    var funcs = [[], []];
    var vars = [];

    // we reconstruct two functions
    // first function is the init function and resembles the original
    // except for the yield. at the point of yield it will return its
    // operand and no longer yield.
    // the second function will start at the yield. previous blocks
    // will simply start with a {, the rest remains the same.

    function tmp(start, end, whiling) {
      var out0point = funcs[0].length;
      var out1point = funcs[1].length;
      var foundYield = false;
      if (!whiling) whiling = 0;

      for (var j=start; j<end; ++j) {
        var t = wlist[j];

        // TODO: function declarations have the same hoisting problem, require rewrite too
        if (t.isVarKeyword) {
          vars.push.apply(vars, t.vars);
          t.value = '';
        }

        if (whiling && t.isBreakKeyword) {
          funcs[0].push('break');
          funcs[1].push(
            '{var ',prefix,'broke_',whiling,' = true;\nbreak;\n}'
          );
        } else if (whiling && t.isContinueKeyword) {
          funcs[0].push('continue');
          funcs[1].push('break;'); // will fall into the complete loop. I think.
        } else if (t.isWhileKeyword && j!==start) {
          // note: _only_ possible loop at this point is a regular `while`
          foundYield = tmp(j, t.stmtEnd.white, whiling+1) || foundYield;
          j = t.stmtEnd.white-1;
        } else {

          if (j<stmtStart) {
            if (t.isBlockStart) {
              funcs[1].push(t.value);
            }
            if (j<stmtStart || j>=stmtEnd) {
              funcs[0].push(t.value);
            }
          } else if (j>=stmtEnd) {
            if (j===stmtEnd) { // tbh this is just a hack and it shouldn't really be needed :(
              funcs[0].push(';');
              funcs[1].push(';');
            }
            funcs[0].push(t.value);
            funcs[1].push(t.value);
          } else if (j===stmtStart) {
            foundYield = true;
            funcs[0].push('return ('+prefix+'ielded=true, '+(yieldExpr||undefined)+')');
            funcs[1].push(yieldStmt);
          }
          t.value = '';
        }
      }

      if (whiling && foundYield) {
        // there was a yield in this loop
        // funcs[1] will now contain a partial body of the loop, without loop head (no `while` keyword)
        // wrap entire thing in a `do <stmt> while();` (<stmt> has to be one statement)
        // this will prevent syntax errors for unbound break/while's.

        // full loop will be appended, but prefix it with a continue check
        // this way we can replace `continue` with a `continued=true;break;`

        funcs[1].splice(out1point++, 0,
          '\n{'
        );
        if (whiling === 1) {
          funcs[1].splice(out1point, 0,
            '\nvar','/*',whiling,'*/',' ',prefix,'broke_',whiling,' = false;\n',
            'do','/*',whiling,'*/',' \n'
          );
          funcs[1].push(
            '\nwhile','/*',whiling,'*/','(false/*prevent continue/break problems*/);\n',
            'if','/*',whiling,'*/',' (!',prefix,'broke_',whiling,')'
          );
        }
        funcs[1].push(
          funcs[0].slice(out0point).join(''),
          '\n}'
        );
      }

      return foundYield;
    }

    tmp(func.lhc.white+1, func.rhc.white);

    if (vars.length) {
      func.lhc.value += 'var '+vars.join(', ')+';\n';
    }

    // yielded: either we track that the function finished, or we track that the function yielded
    // since finished means we have to wrap all return args too, which we already do for yield
    // expressions anyways, we might as well track yields. that way we can leave return alone :)

    func.lhc.value += ('\n'+
      '\t\tvar '+prefix+'that = this;\n' +
      '\t\tvar '+prefix+'started = false;\n' +
      '\t\tvar '+prefix+'ielded = true;\n\n' +
      '\t\tfunction f1(){\n'+prefix+'ielded=false;\n'+funcs[0].join('')+'}\n\n' +
      '\t\tfunction f2('+prefix+'yieldValue){\n'+prefix+'ielded=false;\n'+funcs[1].join('')+'\n}\n\n' +
      '\t\treturn {\n' +
      '\t\t\tnext: function(v){\n' +
      '\t\t\t\tif (arguments.length > 1) throw "next() only accepts zero or one arguments...";\n'+
      '\t\t\t\tif (!'+prefix+'started) {\n' +
      '\t\t\t\t\t'+prefix+'started = true;\n' +
      '\t\t\t\t\tif (arguments.length) throw "cant send value before start";\n' +
      '\t\t\t\t\treturn {value:f1.call('+prefix+'that), done:!'+prefix+'ielded};\n' +
      '\t\t\t\t}\n' +
      '\t\t\t\tif ('+prefix+'ielded) {\n' +
      '\t\t\t\t\treturn {value:f2.call('+prefix+'that, v), done:!'+prefix+'ielded};\n' +
      '\t\t\t\t}\n'+
      '\t\t\t\tthrow \'unable to next, iterator finished\';\n' +
      '\t\t\t},\n' +
      '\t\t};\n'
      ).replace(/\t/g,'  ');

  }


  return p.tok.tokens.map(function(o){ return o.value; }).join('');
}
