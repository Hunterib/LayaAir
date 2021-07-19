'use strict';

var fs = require('fs');
var path = require('path');
var esbuild = require('esbuild');
var pluginutils = require('@rollup/pluginutils');
var JoyCon = require('joycon');
var jsoncParser = require('jsonc-parser');
const getImpAbsFile = require("./getImpAbsFile").getImpAbsFile;
const async = require('matched/lib/async');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

var fs__default = /*#__PURE__*/_interopDefaultLegacy(fs);
var path__default = /*#__PURE__*/_interopDefaultLegacy(path);
var JoyCon__default = /*#__PURE__*/_interopDefaultLegacy(JoyCon);

const joycon = new JoyCon__default['default']();
joycon.addLoader({
  test: /\.json$/,
  load: async (file) => {
    const content = await fs__default['default'].promises.readFile(file, "utf8");
    return jsoncParser.parse(content);
  },
  loadSync:(file)=>{
    const content = fs.readFileSync(file, "utf8");
    return jsoncParser.parse(content);
  }
});
const getOptions = async (cwd, tsconfig) => {
  const {data, path} = await joycon.load([tsconfig || "tsconfig.json"], cwd);
  if (path && data) {
    const {jsxFactory, jsxFragmentFactory, target} = data.compilerOptions || {};
    return {
      jsxFactory,
      jsxFragment: jsxFragmentFactory,
      target: target && target.toLowerCase(),
      // tsconfigRaw:JSON.stringify(data)
    };
  }
  return {};
};

const bundle = async (id, pluginContext, plugins, loaders) => {
  var _a, _b;
  const transform = async (inputCode, id2) => {
    let code;
    let map;
    for (const plugin of plugins) {
      if (plugin.transform && plugin.name !== "esbuild") {
        const transformed = await plugin.transform.call(pluginContext, inputCode, id2);
        if (transformed == null)
          continue;
        if (typeof transformed === "string") {
          code = transformed;
        } else if (typeof transformed === "object") {
          if (transformed.code !== null) {
            code = transformed.code;
          }
          if (transformed.map !== null) {
            map = transformed.map;
          }
        }
      }
    }
    return {code, map};
  };
  const result = await esbuild.build({
    entryPoints: [id],
    format: "esm",
    bundle: true,
    write: false,
    sourcemap: true,
    outdir: "dist",
    platform: "node",
    charset:"utf8",
    plugins: [
      {
        name: "rollup",
        setup: (build2) => {
          build2.onResolve({filter: /.+/}, async (args) => {
            const resolved = await pluginContext.resolve(args.path, args.importer);
            if (resolved == null)
              return;
            return {
              external: resolved.external === "absolute" ? true : resolved.external,
              path: resolved.id
            };
          });
          build2.onLoad({filter: /.+/}, async (args) => {
            const loader = loaders[path__default['default'].extname(args.path)];
            let contents;
            for (const plugin of plugins) {
              if (plugin.load && plugin.name !== "esbuild") {
                const loaded = await plugin.load.call(pluginContext, args.path);
                if (loaded == null) {
                  continue;
                } else if (typeof loaded === "string") {
                  contents = loaded;
                  break;
                } else if (loaded && loaded.code) {
                  contents = loaded.code;
                }
              }
            }
            if (contents == null) {
              contents = await fs__default['default'].promises.readFile(args.path, "utf8");
            }
            const transformed = await transform(contents, args.path);
            if (transformed.code) {
              let code = transformed.code;
              if (transformed.map) {
                const map = Buffer.from(typeof transformed.map === "string" ? transformed.map : JSON.stringify(transformed.map)).toString("base64");
                code += `
//# sourceMappingURL=data:application/json;base64,${map}`;
              }
              return {
                contents: code
              };
            }
            return {
              contents,
              loader: loader || "js"
            };
          });
        }
      }
    ]
  });
  return {
    code: (_a = result.outputFiles.find((file) => file.path.endsWith(".js"))) == null ? void 0 : _a.text,
    map: (_b = result.outputFiles.find((file) => file.path.endsWith(".map"))) == null ? void 0 : _b.text
  };
};

const defaultLoaders = {
  ".js": "js",
  ".jsx": "jsx",
  ".ts": "ts",
  ".tsx": "tsx"
};
const warn = async (pluginContext, messages) => {
  if (messages.length > 0) {
    const warnings = await esbuild.formatMessages(messages, {
      kind: "warning",
      color: true
    });
    warnings.forEach((warning) => pluginContext.warn(warning));
  }
};
var index = (options = {}) => {
  let target;
  const loaders = {
    ...defaultLoaders
  };
  if (options.loaders) {
    for (const key of Object.keys(options.loaders)) {
      const value = options.loaders[key];
      if (typeof value === "string") {
        loaders[key] = value;
      } else if (value === false) {
        delete loaders[key];
      }
    }
  }
  const extensions = Object.keys(loaders);
  let baseUrl = "";
  const cwd = process.cwd();
  let tsconfig ;
  if (options.tsconfig) {
    tsconfig =  joycon.loadSync([options.tsconfig], cwd).data;
    let dirname = path.dirname(options.tsconfig)
    baseUrl = path.join(cwd,dirname);
  }else{
    baseUrl = cwd;
  }
  
  const INCLUDE_REGEXP = new RegExp(`\\.(${extensions.map((ext) => ext.slice(1)).join("|")})$`);
  const EXCLUDE_REGEXP = /node_modules/;
  const filter = pluginutils.createFilter(options.include || INCLUDE_REGEXP, options.exclude || EXCLUDE_REGEXP);
  const resolveFile = (resolved, index = false) => {
    for (const ext of extensions) {
      const file = index ? path.join(resolved, `index${ext}`) : `${resolved}${ext}`;
      if (fs.existsSync(file))
        return file;
    }
    return null;
  };
  let plugins = [];
  return {
    name: "esbuild",
    resolveId(importee, importer) {
      if (!importer) {
       return; 
      }
      importer = importer.split("\\").join("/");
      if (path.isAbsolute(importee)) {//不处理绝对路径
        return resolveFile(importee);
      }else{
        if(importee[0] === ".") {//当前文件的相对路径
          return resolveFile(path.resolve(importer ? path.dirname(importer) : process.cwd(), importee));
        }else
          return getImpAbsFile(baseUrl,tsconfig,importee);
      }
    },
    options(options2) {
      plugins = options2.plugins || [];
      return null;
    },
    async load(id) {
      if (options.experimentalBundling) {
        const bundled = await bundle(id, this, plugins, loaders);
        if (bundled.code) {
          return {
            code: bundled.code,
            map: bundled.map
          };
        }
      }
    },
    async transform(code, id) {
      if (!filter(id) || options.experimentalBundling) {
        return null;
      }
      const ext = path.extname(id);
      const loader = loaders[ext];
      if (!loader) {
        return null;
      }
      const defaultOptions = options.tsconfig === false ? {} : await getOptions(path.dirname(id), options.tsconfig);
      target = options.target || defaultOptions.target || "es2017";
      const result = await esbuild.transform(code, {
        loader,
        target,
        charset:"utf8",
        // tsconfigRaw:defaultOptions.tsconfigRaw,
        jsxFactory: options.jsxFactory || defaultOptions.jsxFactory,
        jsxFragment: options.jsxFragment || defaultOptions.jsxFragment,
        define: options.define,
        sourcemap: options.sourceMap !== false,
        sourcefile: id
      });
      await warn(this, result.warnings);
      return result.code && {
        code: result.code,
        map: result.map || null
      };
    },
    async renderChunk(code) {
      if (options.minify || options.minifyWhitespace || options.minifyIdentifiers || options.minifySyntax) {
        const result = await esbuild.transform(code, {
          loader: "js",
          charset:"utf8",
          minify: options.minify,
          minifyWhitespace: options.minifyWhitespace,
          minifyIdentifiers: options.minifyIdentifiers,
          minifySyntax: options.minifySyntax,
          target,
          sourcemap: options.sourceMap !== false
        });
        await warn(this, result.warnings);
        if (result.code) {
          return {
            code: result.code,
            map: result.map || null
          };
        }
      }
      return null;
    }
  };
};

module.exports = index;