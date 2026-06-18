import React, { useState, useRef, useEffect, useCallback } from 'react'

// ---- knobs -------------------------------------------------------------
// Each "item" we add expands into `depth`-nested wrappers. So the real DOM
// node count = items * (depth + 1). Deeply nested trees are often what makes
// a tab choke, not just a flat node count — so depth is adjustable.

// Module-level store of DETACHED nodes we deliberately retain. This simulates
// a real memory leak: nodes removed from the page but still referenced by JS,
// so the GC can never free them. They keep counting toward DevTools'
// "DOM Nodes" metric while being invisible on screen — the exact signature of
// a tab that degrades to "unresponsive" the longer it stays open.
const leakStore = []

function NodeItem({ depth, withListener }) {
  const handlers = withListener
    ? {
        onMouseEnter: (e) => { e.currentTarget.dataset.hot = '1' },
        onMouseLeave: (e) => { delete e.currentTarget.dataset.hot },
        onClick: (e) => { e.currentTarget.style.background = '#3a5' },
      }
    : {}

  let node = <span />
  for (let d = 0; d < depth; d++) {
    node = <span>{node}</span>
  }
  return <i className={depth > 0 ? 'cell deep' : 'cell'} {...handlers}>{node}</i>
}

export default function App() {
  const [items, setItems] = useState([]) // array of ids
  const [batch, setBatch] = useState(10000)
  const [depth, setDepth] = useState(0)
  const [withListener, setWithListener] = useState(false)

  const nextId = useRef(0)
  const [liveEls, setLiveEls] = useState(0) // attached ELEMENTS (matches getElementsByTagName)
  const [liveNodes, setLiveNodes] = useState(0) // attached nodes incl. text/comments
  const [leakedCount, setLeakedCount] = useState(0) // detached nodes we retain (the "leak")
  const [fps, setFps] = useState(0)
  const [worstFrame, setWorstFrame] = useState(0)
  const [mem, setMem] = useState(null)
  const spinnerRef = useRef(null)

  const addItems = useCallback((n) => {
    setItems((prev) => {
      const start = nextId.current
      const more = new Array(n)
      for (let i = 0; i < n; i++) more[i] = start + i
      nextId.current = start + n
      return prev.concat(more)
    })
  }, [])

  const clearItems = useCallback(() => {
    setItems([])
    setWorstFrame(0)
  }, [])

  // Deliberately leak detached nodes: build subtrees, never attach them, and
  // keep a reference forever. Live element count does NOT move; DevTools
  // "DOM Nodes" climbs. This is what a real detached-node leak looks like.
  const leakNodes = useCallback((n) => {
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div')
      const child = document.createElement('span')
      child.textContent = 'leaked' // adds a text node too
      el.appendChild(child)
      leakStore.push(el) // retained → never garbage-collected
    }
    setLeakedCount(leakStore.length * 3) // div + span + text node per item
  }, [])

  const freeLeaks = useCallback(() => {
    leakStore.length = 0 // drop references; nodes become collectable on next GC
    setLeakedCount(0)
  }, [])

  // FPS / responsiveness heartbeat. We rotate a spinner via rAF and measure
  // frame deltas. When the main thread is blocked (layout/reconciliation on a
  // huge DOM), the spinner visibly stutters and worstFrame spikes.
  useEffect(() => {
    let raf
    let last = performance.now()
    let angle = 0
    let frames = 0
    let acc = 0
    let worst = 0

    const tick = (now) => {
      const dt = now - last
      last = now
      angle = (angle + dt * 0.36) % 360
      if (spinnerRef.current) {
        spinnerRef.current.style.transform = `rotate(${angle}deg)`
      }
      frames++
      acc += dt
      if (dt > worst) worst = dt
      if (acc >= 500) {
        setFps(Math.round((frames * 1000) / acc))
        setWorstFrame(Math.round(worst))
        frames = 0
        acc = 0
        worst = 0
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Sample DOM node counts + memory periodically.
  // - liveEls: attached ELEMENTS only (what getElementsByTagName returns)
  // - liveNodes: every attached node incl. text/comment (closer to, but still
  //   less than, DevTools "DOM Nodes" because DevTools also counts DETACHED
  //   nodes still held in memory — see leakStore above).
  useEffect(() => {
    const id = setInterval(() => {
      setLiveEls(document.getElementsByTagName('*').length)

      let total = 0
      const walker = document.createTreeWalker(document, NodeFilter.SHOW_ALL)
      while (walker.nextNode()) total++
      setLiveNodes(total)

      if (performance.memory) {
        setMem({
          used: performance.memory.usedJSHeapSize,
          limit: performance.memory.jsHeapSizeLimit,
        })
      }
    }, 700)
    return () => clearInterval(id)
  }, [])

  const fpsClass = fps >= 50 ? '' : fps >= 25 ? 'warn' : 'bad'
  const frameClass = worstFrame <= 32 ? '' : worstFrame <= 100 ? 'warn' : 'bad'
  const leakClass = leakedCount === 0 ? '' : 'bad'
  const mb = (b) => (b / 1048576).toFixed(0)

  return (
    <>
      <div className="toolbar">
        <h1>DOM Stress Test</h1>
        <label className="opt">
          batch
          <input
            type="number"
            value={batch}
            min={1}
            onChange={(e) => setBatch(Math.max(1, +e.target.value || 0))}
          />
        </label>
        <button onClick={() => addItems(batch)}>+ batch</button>
        <button onClick={() => addItems(1000)}>+1k</button>
        <button onClick={() => addItems(10000)}>+10k</button>
        <button onClick={() => addItems(50000)}>+50k</button>
        <button className="danger" onClick={clearItems}>clear</button>

        <label className="opt">
          depth
          <input
            type="number"
            value={depth}
            min={0}
            max={50}
            onChange={(e) => setDepth(Math.max(0, Math.min(50, +e.target.value || 0)))}
          />
        </label>
        <label className="opt">
          <input
            type="checkbox"
            checked={withListener}
            onChange={(e) => setWithListener(e.target.checked)}
          />
          event listeners per node
        </label>

        <span className="divider" />
        {/* Leak mode: create detached nodes and retain them forever. */}
        <button className="leak" onClick={() => leakNodes(10000)}>leak +10k detached</button>
        <button className="leak" onClick={() => leakNodes(100000)}>leak +100k</button>
        <button onClick={freeLeaks}>free leaks</button>
      </div>

      <div className="stats">
        <div className="stat">
          <span className="label">React items</span>
          <span className="value">{items.length.toLocaleString()}</span>
        </div>
        <div className="stat">
          <span className="label">Live elements</span>
          <span className="value">{liveEls.toLocaleString()}</span>
          <span className="sub">getElementsByTagName</span>
        </div>
        <div className="stat">
          <span className="label">Live nodes (incl. text)</span>
          <span className="value">{liveNodes.toLocaleString()}</span>
          <span className="sub">attached, all types</span>
        </div>
        <div className="stat">
          <span className="label">Leaked / detached</span>
          <span className={`value ${leakClass}`}>{leakedCount.toLocaleString()}</span>
          <span className="sub">retained, off-screen</span>
        </div>
        <div className="stat">
          <span className="label">FPS</span>
          <span className={`value ${fpsClass}`}>{fps}</span>
        </div>
        <div className="stat">
          <span className="label">Worst frame (ms)</span>
          <span className={`value ${frameClass}`}>{worstFrame}</span>
        </div>
        {mem && (
          <div className="stat">
            <span className="label">JS heap (MB)</span>
            <span className="value">
              {mb(mem.used)} / {mb(mem.limit)}
            </span>
          </div>
        )}
        <div className="stat">
          <span className="label">Heartbeat</span>
          <span className="value">
            <span ref={spinnerRef} className="heartbeat" />
          </span>
        </div>
      </div>

      <div className="node-field">
        {items.map((id) => (
          <NodeItem key={id} depth={depth} withListener={withListener} />
        ))}
      </div>
    </>
  )
}
