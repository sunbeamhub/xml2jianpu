<script>
import { defineComponent, h } from 'vue'
import { NOTATION_JIANPU, NOTATION_STAFF } from '../../utils/osmdRenderer.js'
import SegmentSwitch from '../ui/SegmentSwitch.vue'

const NOTATION_OPTIONS = [
  { value: NOTATION_JIANPU, label: '简谱' },
  { value: NOTATION_STAFF, label: '五线谱' },
]

export default defineComponent({
  name: 'NotationSwitch',
  components: { SegmentSwitch },
  props: {
    modelValue: { type: String, default: NOTATION_JIANPU },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () =>
      h(SegmentSwitch, {
        modelValue: props.modelValue,
        options: NOTATION_OPTIONS,
        field: true,
        tone: 'accent',
        label: '记谱方式',
        'onUpdate:modelValue': (value) => emit('update:modelValue', value),
      })
  },
})
</script>
