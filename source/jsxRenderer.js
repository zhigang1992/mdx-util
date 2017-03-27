/**
 * A renderer for markdown-it that outputs JSX instead of JS.
 *
 * This is heavily based on the original HTML renderer, which you can see here:
 * https://github.com/markdown-it/markdown-it/blob/126bc6bd8b09d12a517ece6f60cbb0eaa7c85654/lib/renderer.js
 */

import Markdown from 'markdown-it'

const { assign, unescapeAll } = new Markdown().utils;


const default_rules = {
  code_inline: (tokens, idx, options, env, slf) =>
    slf.renderElement(tokens[idx], JSON.stringify(tokens[idx].content))
  ,

  code_block: (tokens, idx, options, env, slf) =>
    slf.renderElement(tokens[idx], JSON.stringify(tokens[idx].content))
  ,

  fence: (tokens, idx, options, env, slf) => {
    var token = tokens[idx],
        info = token.info ? unescapeAll(token.info).trim() : '',
        langName = '',
        highlighted, i, tmpAttrs, tmpToken;

    if (info) {
      langName = info.split(/\s+/g)[0];
    }

    if (options.highlight) {
      highlighted = options.highlight(token.content, langName) || token.content;
    } else {
      highlighted = token.content;
    }

    if (highlighted.indexOf('<pre') === 0) {
      return slf.renderElement(token, JSON.stringify(highlighted))
    }

    // If language exists, inject class gently, without mudofying original token.
    // May be, one day we will add .clone() for token and simplify this part, but
    // now we prefer to keep things local.
    if (info) {
      i        = token.attrIndex('class');
      tmpAttrs = token.attrs ? token.attrs.slice() : [];

      if (i < 0) {
        tmpAttrs.push([ 'class', options.langPrefix + langName ]);
      } else {
        tmpAttrs[i][1] += ' ' + options.langPrefix + langName;
      }

      // Fake token just to render attributes
      tmpToken = {
        tag: 'code_block',
        attrs: tmpAttrs
      };

      return slf.renderElement(tmpToken, JSON.stringify(highlighted))
    }

    return slf.renderElement(token, JSON.stringify(highlighted))
  },


  image: (tokens, idx, options, env, slf) => {
    var token = tokens[idx];

    // "alt" attr MUST be set, even if empty.
    // Replace content with actual value

    token.attrs[token.attrIndex('alt')][1] =
      slf.renderInlineAsText(token.children, options, env);

    return slf.renderToken(tokens, idx, options);
  },


  hardbreak: function (tokens, idx, options, env, slf) {
    return slf.indent('<br />');
  },
  softbreak: function (tokens, idx, options, env, slf) {
    return options.breaks ? slf.indent('<br />') : [];
  },


  text: function (tokens, idx, options, env, slf) {
    return slf.indent(JSON.stringify(tokens[idx].content));
  },


  jsx_block: function (tokens, idx, options, env, slf) {
    return slf.indent(tokens[idx].content.trim());
  },
  jsx_inline: function (tokens, idx, options, env, slf) {
    const indent = tokens[idx].nesting
    if (indent === -1) {
      slf.indentLevel -= 2 
    }
    const str = slf.indent(tokens[idx].content.trim());
    if (indent === 1) {
      slf.indentLevel += 2
    }
    return str
  },
}


function camelize(string) {
  return string.replace(/_(.)/g, (_, character) => character.toUpperCase())
}


/**
 * new Renderer()
 *
 * Creates new [[Renderer]] instance and fill [[Renderer#rules]] with defaults.
 **/
function Renderer() {

  /**
   * Renderer#rules -> Object
   *
   * Contains render rules for tokens. Can be updated and extended.
   *
   * ##### Example
   *
   * ```javascript
   * var md = require('markdown-it')();
   *
   * md.renderer.rules.strong_open  = function () { this.tags.add('b'); return 'b({},'; };
   * md.renderer.rules.strong_close = function () { return ')'; };
   *
   * var result = md.renderInline(...);
   * ```
   *
   * Each rule is called as independed static function with fixed signature:
   *
   * ```javascript
   * function my_token_render(tokens, idx, options, env, renderer) {
   *   // ...
   *   return renderedJSX;
   * }
   * ```
   *
   * Any factory functions you use should be added to the tags set, so they'll
   * made available in your JSX's execution context:
   *
   * ```javascript
   * this.tags.add('strong')
   * ```
   **/
  this.rules = assign({}, default_rules);
}


Renderer.prototype.pushResult = function pushResult(results, result) {
  if (Array.isArray(result)) {
    [].push.apply(results, result.filter(line => line.trim().length > 0))
  }
  else if (typeof result === 'string' && result.trim().length > 0) {
    results.push(result)
  }
}


Renderer.prototype.indent = function indent(text) {
  const prefix = Array(this.indentLevel + 1).join(' ')
  return text.split('\n').map(line => prefix+line).join('\n')
}


Renderer.prototype.renderAttrs = function renderAttrs(token) {
  let result = '{'
  if (token.attrs) {
    for (let i = 0, l = token.attrs.length; i < l; i++) {
      const name = token.attrs[i][0]
      const value = token.attrs[i][1]
      const transformedName = {
        'class': 'className',
      }[name] || name
      if (i !== 0) result += ', '
      result += JSON.stringify(transformedName)+': '+(typeof value === 'string' ? JSON.stringify(value) : (value.__jsx)) 
    }
  }
  result += '}'
  return result
};


Renderer.prototype.renderElement = function renderElement(token, ...children) {
  const args = [this.renderAttrs(token)].concat(children)
  const camelizedTag = camelize(token.tag)
  this.tags.add(camelizedTag)
  return this.indent(`${camelizedTag}(${args.join(', ')})`);
};


Renderer.prototype.renderToken = function renderToken(tokens, idx, options) {
  var result = '',
      token = tokens[idx];

  // Tight list paragraphs
  if (token.hidden) {
    return [];
  }

  if (token.nesting === -1) {
    this.indentLevel -= 2;
    return this.indent(')');
  }


  const camelizedTag = camelize(token.tag)
  this.tags.add(camelizedTag)

  // Add token name, e.g. `img(`
  result += this.indent(`${camelizedTag}(`);

  // Encode attributes, e.g. `img({"src": "foo"}`
  result += this.renderAttrs(token);

  // Close the function for self-closing tags, e.g. `img({"src": "foo"})`
  if (token.nesting === 0) {
    result += ')';
  }
  else {
    this.indentLevel += 2;
  }

  return result;
};


Renderer.prototype.renderInline = function (tokens, options, env) {
  var type,
      result = [],
      rules = this.rules;

  for (var i = 0, len = tokens.length; i < len; i++) {
    type = tokens[i].type;

    if (typeof rules[type] !== 'undefined') {
      this.pushResult(result, rules[type](tokens, i, options, env, this));
    } else {
      this.pushResult(result, this.renderToken(tokens, i, options));
    }
  }

  return result;
};


Renderer.prototype.renderInlineAsText = function (tokens, options, env) {
  var result = '';

  for (var i = 0, len = tokens.length; i < len; i++) {
    if (tokens[i].type === 'text') {
      result += tokens[i].content;
    } else if (tokens[i].type === 'image') {
      result += this.renderInlineAsText(tokens[i].children, options, env);
    }
  }

  return result;
};


/**
 * Renderer.render(tokens, options, env) -> String
 * - tokens (Array): list on block tokens to renter
 * - options (Object): params of parser instance
 * - env (Object): additional data from parsed input (references, for example)
 *
 * Takes token stream and generates an exported JSX file that exports a single
 * functional component. Probably, you will never need to call this method
 * directly.
 **/
Renderer.prototype.render = function (tokens, options, env) {
  var i, len, type,
      result = [],
      rules = this.rules;

  this.tags = new Set();
  this.indentLevel = options.initialIndent || 0;

  for (i = 0, len = tokens.length; i < len; i++) {
    type = tokens[i].type;

    if (type === 'inline') {
      this.pushResult(result, this.renderInline(tokens[i].children, options, env))
    } else if (typeof rules[type] !== 'undefined') {
      this.pushResult(result, rules[tokens[i].type](tokens, i, options, env, this))
    } else {
      this.pushResult(result, this.renderToken(tokens, i, options, env))
    }
  }

  return result.join(',\n');
};

module.exports = Renderer;
