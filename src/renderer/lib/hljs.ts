import hljs from 'highlight.js/lib/core'

// Shell & config
import bash from 'highlight.js/lib/languages/bash'
import shell from 'highlight.js/lib/languages/shell'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import yaml from 'highlight.js/lib/languages/yaml'
import json from 'highlight.js/lib/languages/json'
import ini from 'highlight.js/lib/languages/ini'
import nginx from 'highlight.js/lib/languages/nginx'
import makefile from 'highlight.js/lib/languages/makefile'

// Web
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import css from 'highlight.js/lib/languages/css'
import scss from 'highlight.js/lib/languages/scss'
import xml from 'highlight.js/lib/languages/xml'
import graphql from 'highlight.js/lib/languages/graphql'

// Systems
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import rust from 'highlight.js/lib/languages/rust'
import go from 'highlight.js/lib/languages/go'

// JVM
import java from 'highlight.js/lib/languages/java'
import kotlin from 'highlight.js/lib/languages/kotlin'
import scala from 'highlight.js/lib/languages/scala'
import gradle from 'highlight.js/lib/languages/gradle'

// Scripting
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import perl from 'highlight.js/lib/languages/perl'
import lua from 'highlight.js/lib/languages/lua'
import php from 'highlight.js/lib/languages/php'

// Functional
import haskell from 'highlight.js/lib/languages/haskell'
import elixir from 'highlight.js/lib/languages/elixir'
import erlang from 'highlight.js/lib/languages/erlang'
import clojure from 'highlight.js/lib/languages/clojure'
import fsharp from 'highlight.js/lib/languages/fsharp'
import ocaml from 'highlight.js/lib/languages/ocaml'

// .NET
import csharp from 'highlight.js/lib/languages/csharp'

// Apple
import swift from 'highlight.js/lib/languages/swift'
import objectivec from 'highlight.js/lib/languages/objectivec'

// Data & query
import sql from 'highlight.js/lib/languages/sql'
import r from 'highlight.js/lib/languages/r'

// Markup & docs
import markdown from 'highlight.js/lib/languages/markdown'
import latex from 'highlight.js/lib/languages/latex'
import diff from 'highlight.js/lib/languages/diff'

// Misc
import nix from 'highlight.js/lib/languages/nix'
import wasm from 'highlight.js/lib/languages/wasm'
import dart from 'highlight.js/lib/languages/dart'
import powershell from 'highlight.js/lib/languages/powershell'
import protobuf from 'highlight.js/lib/languages/protobuf'
import vim from 'highlight.js/lib/languages/vim'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('shell', shell)
hljs.registerLanguage('dockerfile', dockerfile)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('json', json)
hljs.registerLanguage('ini', ini)
hljs.registerLanguage('nginx', nginx)
hljs.registerLanguage('makefile', makefile)

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('css', css)
hljs.registerLanguage('scss', scss)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('graphql', graphql)

hljs.registerLanguage('c', c)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('go', go)

hljs.registerLanguage('java', java)
hljs.registerLanguage('kotlin', kotlin)
hljs.registerLanguage('scala', scala)
hljs.registerLanguage('gradle', gradle)

hljs.registerLanguage('python', python)
hljs.registerLanguage('ruby', ruby)
hljs.registerLanguage('perl', perl)
hljs.registerLanguage('lua', lua)
hljs.registerLanguage('php', php)

hljs.registerLanguage('haskell', haskell)
hljs.registerLanguage('elixir', elixir)
hljs.registerLanguage('erlang', erlang)
hljs.registerLanguage('clojure', clojure)
hljs.registerLanguage('fsharp', fsharp)
hljs.registerLanguage('ocaml', ocaml)

hljs.registerLanguage('csharp', csharp)

hljs.registerLanguage('swift', swift)
hljs.registerLanguage('objectivec', objectivec)

hljs.registerLanguage('sql', sql)
hljs.registerLanguage('r', r)

hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('latex', latex)
hljs.registerLanguage('diff', diff)

hljs.registerLanguage('nix', nix)
hljs.registerLanguage('wasm', wasm)
hljs.registerLanguage('dart', dart)
hljs.registerLanguage('powershell', powershell)
hljs.registerLanguage('protobuf', protobuf)
hljs.registerLanguage('vim', vim)

export default hljs
