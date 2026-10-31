# Bundled OG renderer

OPTZ source is MIT licensed; see LICENSE. Third-party components retain their own licenses.

The npm archive includes Satori 0.63.2 and its JavaScript/WASM dependency tree so consumers
receive patched fflate 0.7.5 even though upstream Satori pins 0.7.3. Each bundled package
retains its package metadata and license files. The Satori package manifest is modified only
to select fflate 0.7.5; its implementation files are unchanged.

Satori is MPL-2.0 licensed. Corresponding source for this version is available at
https://github.com/vercel/satori/tree/074f0b38ed0f5d8fa768f709c0bb072b2d6c99e1.
The manifest change is available in the OPTZ repository at patches/satori@0.63.2.patch:
https://github.com/sxnistxr/OPTZ/blob/main/patches/satori%400.63.2.patch.
The MPL license text accompanies the bundled Satori package in node_modules/satori/LICENSE.

Optional native image tools (sharp/libvips and resvg) and build peers (including Tailwind's
Lightning CSS) have additional third-party license notices in their installed packages.
Keep those notices with redistributed dependencies.
