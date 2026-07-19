// vue-tsc emits declarations for `Foo.vue` as `Foo.vue.d.ts`, but relative
// imports/exports in source reference the SFC as `./Foo.vue` — a specifier
// that Node16/NodeNext type resolution can't map back to `Foo.vue.d.ts`
// (it only knows how to substitute known JS-like extensions for `.d.ts`).
// This leaves `.vue`-exported entry points ("./markdown") failing type
// resolution for consumers on `moduleResolution: node16`/`nodenext`.
//
// Fix: rewrite `.d.ts` specifiers that point at `*.vue` to the `.js`-suffixed
// sibling, then rename each `Foo.vue.d.ts` to a plain `Foo.d.ts` so that
// sibling actually resolves. This only touches type declarations — runtime
// imports (which Vite bundles from the real `.vue` file) are untouched.

import { readdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const distDir = fileURLToPath(new URL('../dist/', import.meta.url))

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch((err) => {
    if (err.code === 'ENOENT') {
      console.error(`fix-vue-dts: ${dir} does not exist — run the build first`)
      process.exit(1)
    }
    throw err
  })
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await walk(full))
    else files.push(full)
  }
  return files
}

const allFiles = await walk(distDir)
const dtsFiles = allFiles.filter((f) => f.endsWith('.d.ts'))
const vueSpecifier = /from\s+(['"])(\.[^'"]*)\.vue\1/g

// rewrite specifiers first, so the renamed declarations below already carry
// fixed specifiers when another SFC's declaration references them
for (const file of dtsFiles) {
  const content = await readFile(file, 'utf8')
  if (!vueSpecifier.test(content)) continue
  vueSpecifier.lastIndex = 0
  const fixed = content.replace(vueSpecifier, (_match, quote, path) => `from ${quote}${path}.js${quote}`)
  await writeFile(file, fixed, 'utf8')
}

for (const file of dtsFiles.filter((f) => f.endsWith('.vue.d.ts'))) {
  const plainDts = file.replace(/\.vue\.d\.ts$/, '.d.ts')
  if (allFiles.includes(plainDts)) {
    // a co-located `Foo.ts` already produced `Foo.d.ts` — renaming would clobber it
    console.error(`fix-vue-dts: refusing to overwrite existing ${plainDts}`)
    process.exit(1)
  }
  await rename(file, plainDts)
}
