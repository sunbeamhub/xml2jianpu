<script>
import { h } from 'vue'
import { splitInlineCode } from '../utils/releaseNotes.js'

export default {
  name: 'ReleaseInline',
  props: {
    text: { type: String, default: '' },
  },
  setup(props) {
    return () => splitInlineCode(props.text).map((part, index) => (
      part.code
        ? h('code', { key: index, class: 'release-inline-code' }, part.text)
        : part.text
    ))
  },
}
</script>

<style>
.release-inline-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.92em;
}
</style>
