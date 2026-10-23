import { clientBundle } from '../tsdown.client.ts'

export default clientBundle(
  import.meta.dirname,
  ['lib/types/index.js'],
  {
    lib: {
      copy: [{
        from: 'src/styles/{brand-font.css,editorial-font.css,interface-font.css,montserrat-*.woff2,source-serif-4-*.woff2,inter-*.woff2,Montserrat-OFL.txt,SourceSerif4-OFL.txt,Inter-OFL.txt}',
        to: 'lib/styles',
      }],
    },
  },
)
