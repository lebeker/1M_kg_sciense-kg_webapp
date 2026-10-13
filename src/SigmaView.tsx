import { useEffect, useRef } from 'react'
import Sigma from 'sigma'
import { type Kg, pxSize } from './kg'

type Props = {
  kg: Kg
  selected: string | null
  onSelect: (id: string | null) => void
  fitSignal: number
}

export default function SigmaView({ kg, selected, onSelect, fitSignal }: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  const sigma = useRef<Sigma | null>(null)
  const selRef = useRef<string | null>(selected)
  const selectRef = useRef(onSelect)
  selRef.current = selected
  selectRef.current = onSelect

  // Fit, then back off a little: sigma's reset fits node centres, so a big circle or a
  // label at the edge of the frame ends up half outside it.
  const fitCamera = (cam: ReturnType<Sigma['getCamera']>) => {
    cam
      .animatedReset()
      .then(() => {
        const state = cam.getState()
        cam.setState({ ...state, ratio: state.ratio * 1.15 })
      })
      .catch(() => {})
  }

  useEffect(() => {
    const el = host.current
    if (!el) return
    // A five-node graph should show its five labels; a thousand-node one cannot. The
    // threshold is a property of the graph, not a taste, so it is derived from it.
    const small = kg.graph.order <= 50
    const instance = new Sigma(kg.graph, el, {
      renderEdgeLabels: false,
      defaultEdgeColor: '#2b3038',
      labelColor: { color: '#c7ccd6' },
      labelSize: 12,
      labelRenderedSizeThreshold: small ? 0 : 7,
      labelDensity: small ? 1 : 0.5,
      minCameraRatio: 0.01,
      maxCameraRatio: 20,
      nodeReducer: (node, data) => {
        data.size = pxSize(data.size)
        const sel = selRef.current
        if (!sel || node === sel) return data
        return { ...data, color: '#333842', label: '', size: Math.min(data.size, 8) }
      },
    })

    instance.on('clickNode', ({ node }) => selectRef.current(node))
    instance.on('clickStage', () => selectRef.current(null))
    fitCamera(instance.getCamera())

    sigma.current = instance
    return () => {
      sigma.current = null
      instance.kill()
    }
  }, [kg])

  // selection only changes how nodes are drawn: refresh, never rebuild
  useEffect(() => {
    sigma.current?.refresh()
  }, [selected])

  useEffect(() => {
    if (sigma.current) fitCamera(sigma.current.getCamera())
  }, [fitSignal])

  return <div className="canvas" ref={host} />
}
