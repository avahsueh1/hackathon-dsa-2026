import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Car,
  Database,
  ExternalLink,
  Eye,
  Info,
  Layers,
  MapPin,
  ShieldAlert,
  Tent,
  Users,
} from 'lucide-react'
import { policyMapFixture } from './fixtures/policy-map'
import type {
  OrdinanceOffenseCluster,
  PolicyMapFeature,
  PolicyMapPayload,
  PolicyMetric,
  SafeSleepingSite,
} from './types'

type Point = [number, number]
type SourceMode = 'loading' | 'live' | 'fixture'
type Selection =
  | { type: 'block'; id: string | number }
  | { type: 'site'; id: string }
  | { type: 'offense'; id: string }

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000'
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

const metricMeta: Record<PolicyMetric, { label: string; shortLabel: string; unit: string }> = {
  adjusted: { label: 'Weighted observed change', shortLabel: 'Weighted', unit: 'people-equivalent' },
  individuals: { label: 'Recorded individual marks', shortLabel: 'Individuals', unit: 'marks' },
  tentsStructures: { label: 'Tent / structure marks', shortLabel: 'Structures', unit: 'marks' },
  vehicles: { label: 'Vehicle habitation marks', shortLabel: 'Vehicles', unit: 'marks' },
}

function signed(value: number, suffix = '') {
  return `${value > 0 ? '+' : ''}${number.format(value)}${suffix}`
}

function fullDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })
}

function shortDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function featurePolygons(feature: PolicyMapFeature): Point[][][] {
  const coordinates = feature.geometry.coordinates as unknown
  return feature.geometry.type === 'Polygon'
    ? [coordinates as Point[][]]
    : coordinates as Point[][][]
}

function pointInRing(point: Point, ring: Point[]) {
  const [x, y] = point
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [currentX, currentY] = ring[index]
    const [previousX, previousY] = ring[previous]
    const crosses = (currentY > y) !== (previousY > y)
      && x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX
    if (crosses) inside = !inside
  }
  return inside
}

function pointInFeature(point: Point, feature: PolicyMapFeature) {
  return featurePolygons(feature).some((polygon) => {
    const [outer, ...holes] = polygon
    return pointInRing(point, outer) && !holes.some((hole) => pointInRing(point, hole))
  })
}

function normalizeSites(payload: PolicyMapPayload['safeSleepingSites']): SafeSleepingSite[] {
  if (Array.isArray(payload)) return payload
  return payload.features.map((feature) => ({
    ...feature.properties,
    longitude: feature.geometry.coordinates[0],
    latitude: feature.geometry.coordinates[1],
  }))
}

function markerPositionLabel(site: SafeSleepingSite) {
  if (!site.outsidePanel) return 'Inside the fixed comparison area'
  if (site.distanceToPanelMeters) return `Outside panel · about ${whole.format(site.distanceToPanelMeters)} m from nearest block`
  return 'Outside the fixed 261-block comparison area'
}

function MapInspector({
  metric,
  block,
  site,
  offense,
  offenseSourceUrl,
}: {
  metric: PolicyMetric
  block?: PolicyMapFeature
  site?: SafeSleepingSite
  offense?: OrdinanceOffenseCluster
  offenseSourceUrl: string
}) {
  if (offense) {
    const dates = offense.firstDate === offense.lastDate
      ? fullDate(offense.firstDate)
      : `${shortDate(offense.firstDate)}–${shortDate(offense.lastDate)}`
    return (
      <aside className="map-inspector offense-inspector">
        <div className="inspector-type"><ShieldAlert size={14} /> Police-recorded ordinance offense</div>
        <h3>{offense.neighborhood}</h3>
        <p className="inspector-area">Rounded three-decimal location cluster</p>
        <div className="selected-metric offense-count">
          <span>SDMC §{offense.subsection}</span>
          <strong>{offense.recordCount}</strong>
          <small>{offense.recordCount === 1 ? 'NIBRS offense record' : 'NIBRS offense records'}</small>
        </div>
        <div className="site-fact"><span>Occurrence date{offense.recordCount > 1 ? ' range' : ''}</span><strong>{dates}</strong></div>
        <div className="outside-note warning-note"><AlertTriangle size={15} /><span>This is not a raid, cleanup, citation, arrest, or identified person. It is an offense in an SDPD case record, plotted at a generalized hundred-block location.</span></div>
        <a className="source-link" href={offenseSourceUrl} target="_blank" rel="noreferrer">City Police NIBRS dataset<ExternalLink size={13} /></a>
      </aside>
    )
  }

  if (site) {
    return (
      <aside className="map-inspector site-inspector">
        <div className="inspector-type"><MapPin size={14} /> Safe Sleeping site</div>
        <h3>{site.name}</h3>
        <p className="inspector-area">{site.address}</p>
        <div className="site-fact"><span>Opening</span><strong>{site.openingLabel}</strong></div>
        <div className="site-fact"><span>Initial capacity</span><strong>{site.capacityLabel}</strong></div>
        <div className="outside-note"><Info size={15} /><span>{markerPositionLabel(site)}. The marker adds policy context; it is not a measured block result.</span></div>
        {site.coordinateNote && <p className="coordinate-note">{site.coordinateNote}</p>}
        <a className="source-link" href={site.sourceUrl} target="_blank" rel="noreferrer">
          {site.sourceLabel}<ExternalLink size={13} />
        </a>
      </aside>
    )
  }

  if (!block) return null
  const { before, after, delta } = block.properties
  return (
    <aside className="map-inspector">
      <div className="inspector-type"><Eye size={14} /> Selected block</div>
      <h3>{String(block.properties.blockId).replaceAll('_', ' ')}</h3>
      <p className="inspector-area">{block.properties.area}</p>
      <div className="selected-metric">
        <span>{metricMeta[metric].label}</span>
        <strong className={delta[metric] < 0 ? 'decrease-text' : delta[metric] > 0 ? 'increase-text' : ''}>
          {signed(delta[metric])}
        </strong>
        <small>{metricMeta[metric].unit} · after minus before</small>
      </div>
      <div className="block-breakdown">
        <div className="breakdown-head"><span>Observed mark</span><span>Jan 31 ’23</span><span>Jan 25 ’24</span><span>Change</span></div>
        <div><strong>Individuals</strong><span>{number.format(before.individuals)}</span><span>{number.format(after.individuals)}</span><span>{signed(delta.individuals)}</span></div>
        <div><strong>Structures</strong><span>{number.format(before.tentsStructures)}</span><span>{number.format(after.tentsStructures)}</span><span>{signed(delta.tentsStructures)}</span></div>
        <div><strong>Vehicles</strong><span>{number.format(before.vehicles)}</span><span>{number.format(after.vehicles)}</span><span>{signed(delta.vehicles)}</span></div>
        <div className="weighted-row"><strong>Weighted</strong><span>{number.format(before.adjusted)}</span><span>{number.format(after.adjusted)}</span><span>{signed(delta.adjusted)}</span></div>
      </div>
      <p className="inspector-caveat">This compares two block observations. It does not track the same person from one place to another.</p>
    </aside>
  )
}

function ChangeMap({ data }: { data: PolicyMapPayload }) {
  const [metric, setMetric] = useState<PolicyMetric>('adjusted')
  const [showSites, setShowSites] = useState(true)
  const [showOffenses, setShowOffenses] = useState(true)
  const sites = useMemo(() => normalizeSites(data.safeSleepingSites), [data.safeSleepingSites])
  const offenseClusters = data.ordinanceOffenseLayer.clusters
  const features = data.geojson.features
  const [selection, setSelection] = useState<Selection>(() => ({ type: 'block', id: features[0]?.properties.blockId ?? '' }))

  const width = 920
  const height = 650
  const pad = 34
  const polygonPoints = useMemo(
    () => features.flatMap((feature) => featurePolygons(feature).flatMap((polygon) => polygon.flat())),
    [features],
  )
  const bounds = useMemo(() => {
    const points = polygonPoints
    const xs = points.map(([x]) => x)
    const ys = points.map(([, y]) => y)
    const raw = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
    const xMargin = Math.max((raw.maxX - raw.minX) * 0.04, 0.0004)
    const yMargin = Math.max((raw.maxY - raw.minY) * 0.04, 0.0004)
    return { minX: raw.minX - xMargin, maxX: raw.maxX + xMargin, minY: raw.minY - yMargin, maxY: raw.maxY + yMargin }
  }, [polygonPoints])

  const project = (point: Point): Point => [
    pad + ((point[0] - bounds.minX) / Math.max(0.000001, bounds.maxX - bounds.minX)) * (width - pad * 2),
    pad + ((bounds.maxY - point[1]) / Math.max(0.000001, bounds.maxY - bounds.minY)) * (height - pad * 2),
  ]
  const pointIsInPanel = (point: Point) => features.some((feature) => pointInFeature(point, feature))
  const insideSites = sites.filter((site) => pointIsInPanel([site.longitude, site.latitude]))
  const outsideSites = sites.filter((site) => !pointIsInPanel([site.longitude, site.latitude]))
  const insideOffenses = offenseClusters.filter((cluster) => pointIsInPanel([cluster.longitude, cluster.latitude]))
  const outsideOffenses = offenseClusters.filter((cluster) => !pointIsInPanel([cluster.longitude, cluster.latitude]))

  const inset = { x: width - 300, y: 20, width: 280, height: 226, left: 42, right: 42, top: 52, bottom: 25 }
  const contextBounds = useMemo(() => {
    const overlayPoints: Point[] = [
      ...sites.map((site) => [site.longitude, site.latitude] as Point),
      ...offenseClusters.map((cluster) => [cluster.longitude, cluster.latitude] as Point),
    ]
    const points = [...polygonPoints, ...overlayPoints]
    const xs = points.map(([x]) => x)
    const ys = points.map(([, y]) => y)
    const raw = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
    const xMargin = Math.max((raw.maxX - raw.minX) * 0.07, 0.0005)
    const yMargin = Math.max((raw.maxY - raw.minY) * 0.07, 0.0005)
    return { minX: raw.minX - xMargin, maxX: raw.maxX + xMargin, minY: raw.minY - yMargin, maxY: raw.maxY + yMargin }
  }, [offenseClusters, polygonPoints, sites])
  const contextProject = (point: Point): Point => [
    inset.x + inset.left + ((point[0] - contextBounds.minX) / Math.max(0.000001, contextBounds.maxX - contextBounds.minX)) * (inset.width - inset.left - inset.right),
    inset.y + inset.top + ((contextBounds.maxY - point[1]) / Math.max(0.000001, contextBounds.maxY - contextBounds.minY)) * (inset.height - inset.top - inset.bottom),
  ]
  const pathFor = (feature: PolicyMapFeature) => featurePolygons(feature)
    .map((polygon) => polygon.map((ring) => ring.map((point, index) => {
      const [x, y] = project(point)
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ') + ' Z').join(' ')).join(' ')
  const contextPathFor = (feature: PolicyMapFeature) => featurePolygons(feature)
    .map((polygon) => polygon.map((ring) => ring.map((point, index) => {
      const [x, y] = contextProject(point)
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ') + ' Z').join(' ')).join(' ')

  const scaleLimit = useMemo(() => {
    const ordered = features.map((feature) => Math.abs(feature.properties.delta[metric])).sort((a, b) => a - b)
    return Math.max(1, ordered[Math.floor((ordered.length - 1) * 0.94)] ?? 1)
  }, [features, metric])
  const fillFor = (feature: PolicyMapFeature) => {
    const value = feature.properties.delta[metric]
    if (Math.abs(value) < 0.001) return '#d8ddd7'
    const strength = Math.min(1, Math.sqrt(Math.abs(value) / scaleLimit))
    const opacity = 0.28 + strength * 0.72
    return value < 0 ? `rgba(18, 117, 100, ${opacity})` : `rgba(210, 79, 45, ${opacity})`
  }
  const selectedBlock = selection.type === 'block'
    ? features.find((feature) => feature.properties.blockId === selection.id) ?? features[0]
    : undefined
  const selectedSite = selection.type === 'site' ? sites.find((site) => site.id === selection.id) : undefined
  const selectedOffense = selection.type === 'offense' ? offenseClusters.find((cluster) => cluster.id === selection.id) : undefined

  return (
    <section className="map-section" id="change-map">
      <div className="map-toolbar">
        <div>
          <p className="section-kicker">After minus before · every fixed block</p>
          <h2>Change the layer to see what drove the pattern</h2>
        </div>
        <div className="metric-tabs" aria-label="Map measure">
          {(Object.keys(metricMeta) as PolicyMetric[]).map((key) => (
            <button key={key} className={metric === key ? 'active' : ''} onClick={() => setMetric(key)}>{metricMeta[key].shortLabel}</button>
          ))}
        </div>
      </div>
      <div className="map-definition">
        <Info size={16} />
        <p><strong>This is a difference map, not a movement map.</strong> Each block’s color is its {metricMeta[metric].shortLabel.toLowerCase()} value on January 25, 2024 minus its value on January 31, 2023.</p>
        <div className="layer-toggles">
          <button className={showSites ? 'layer-toggle active' : 'layer-toggle'} onClick={() => setShowSites((value) => !value)}>
            <Layers size={14} /> Safe Sleeping sites
          </button>
          <button className={showOffenses ? 'layer-toggle offense-layer-toggle active' : 'layer-toggle offense-layer-toggle'} onClick={() => setShowOffenses((value) => !value)}>
            <ShieldAlert size={14} /> §63.0404 records
          </button>
        </div>
      </div>
      {showOffenses && <div className="offense-layer-note"><ShieldAlert size={15} /><p><strong>{data.ordinanceOffenseLayer.within500mOfPanelCount} of {data.ordinanceOffenseLayer.citywideRecordCount}</strong> police-recorded §63.0404 offenses in the policy window were within 500 m of this study area. Six rounded clusters are shown; they are case records, not “raid” locations.</p><a href={data.ordinanceOffenseLayer.sourceUrl} target="_blank" rel="noreferrer">Source & caveats<ExternalLink size={12} /></a></div>}
      <div className="map-layout">
        <div className="map-canvas">
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metricMeta[metric].label} by downtown block with Safe Sleeping site markers`}>
            <g className="block-layer">
              {features.map((feature) => {
                const selected = selectedBlock?.properties.blockId === feature.properties.blockId
                return (
                  <path
                    key={String(feature.properties.blockId)}
                    d={pathFor(feature)}
                    fill={fillFor(feature)}
                    stroke={selected ? '#071f25' : '#f7f8f3'}
                    strokeWidth={selected ? 2.6 : 0.72}
                    onMouseEnter={() => setSelection({ type: 'block', id: feature.properties.blockId })}
                    onClick={() => setSelection({ type: 'block', id: feature.properties.blockId })}
                  />
                )
              })}
            </g>
            {showSites && <g className="site-layer">
              {insideSites.map((site, index) => {
                const [x, y] = project([site.longitude, site.latitude])
                const active = selectedSite?.id === site.id
                return (
                  <g key={site.id} className={active ? 'site-marker active' : 'site-marker'} transform={`translate(${x}, ${y})`} onClick={() => setSelection({ type: 'site', id: site.id })}>
                    <circle className="site-halo" r={active ? 22 : 18} />
                    <circle className="site-dot" r={active ? 10 : 8} />
                    <path d="M-4.5,3 L0,-5 L4.5,3 Z" />
                    <text x={index === 0 ? 14 : -14} y={index === 0 ? 4 : -13} textAnchor={index === 0 ? 'start' : 'end'}>{site.name.replace(' Safe Sleeping', '')}</text>
                  </g>
                )
              })}
            </g>}
            {showOffenses && <g className="offense-layer">
              {insideOffenses.map((cluster) => {
                const [x, y] = project([cluster.longitude, cluster.latitude])
                const active = selectedOffense?.id === cluster.id
                return (
                  <g key={cluster.id} className={active ? 'offense-marker active' : 'offense-marker'} transform={`translate(${x}, ${y})`} onClick={() => setSelection({ type: 'offense', id: cluster.id })}>
                    <circle className="offense-halo" r={active ? 18 : 14} />
                    <circle className="offense-dot" r={active ? 10 : 8} />
                    <text y="3">{cluster.recordCount}</text>
                  </g>
                )
              })}
            </g>}
            {(showSites && outsideSites.length > 0 || showOffenses && outsideOffenses.length > 0) && <g className="context-inset">
              <rect className="context-inset-bg" x={inset.x} y={inset.y} width={inset.width} height={inset.height} rx="13" />
              <text className="context-inset-title" x={inset.x + 15} y={inset.y + 19}>NEARBY CONTEXT</text>
              <text className="context-inset-subtitle" x={inset.x + 15} y={inset.y + 34}>Outside markers stay in this inset</text>
              <g className="context-panel-layer">
                {features.map((feature) => <path key={`context-${String(feature.properties.blockId)}`} d={contextPathFor(feature)} />)}
              </g>
              {showSites && outsideSites.map((site, index) => {
                const [x, y] = contextProject([site.longitude, site.latitude])
                const active = selectedSite?.id === site.id
                const labelOnLeft = x > inset.x + inset.width / 2
                return (
                  <g key={`context-${site.id}`} className={active ? 'context-site-marker active' : 'context-site-marker'} transform={`translate(${x}, ${y})`} onClick={() => setSelection({ type: 'site', id: site.id })}>
                    <circle r={active ? 8 : 6.5} />
                    <path d="M-3.2,2.2 L0,-3.6 L3.2,2.2 Z" />
                    <text x={labelOnLeft ? -9 : 9} y={index === 0 ? 3 : -8} textAnchor={labelOnLeft ? 'end' : 'start'}>{site.name.startsWith('20th') ? '20th & B' : 'O Lot'}</text>
                  </g>
                )
              })}
              {showOffenses && outsideOffenses.map((cluster) => {
                const [x, y] = contextProject([cluster.longitude, cluster.latitude])
                const active = selectedOffense?.id === cluster.id
                return (
                  <g key={`context-${cluster.id}`} className={active ? 'context-offense-marker active' : 'context-offense-marker'} transform={`translate(${x}, ${y})`} onClick={() => setSelection({ type: 'offense', id: cluster.id })}>
                    <circle r={active ? 6.5 : 5} />
                    <text y="2.4">{cluster.recordCount}</text>
                  </g>
                )
              })}
              <text className="context-panel-label" x={inset.x + 15} y={inset.y + inset.height - 8}>Fixed 261-block study area</text>
            </g>}
          </svg>
          <div className="map-legend">
            <span><i className="legend-swatch decrease" /> Decrease</span>
            <span><i className="legend-swatch unchanged" /> No change</span>
            <span><i className="legend-swatch increase" /> Increase</span>
            {showSites && <span><i className="legend-site" /> Safe Sleeping site</span>}
            {showOffenses && <span><i className="legend-offense">1</i> Recorded §63.0404 offense</span>}
          </div>
          <div className="map-hint">Hover a block · click a marker in the map or context inset</div>
        </div>
        <MapInspector metric={metric} block={selectedBlock} site={selectedSite} offense={selectedOffense} offenseSourceUrl={data.ordinanceOffenseLayer.sourceUrl} />
      </div>
    </section>
  )
}

function Timeline({ data }: { data: PolicyMapPayload }) {
  return (
    <section className="timeline-section">
      <div className="section-heading">
        <div><p className="section-kicker">The comparison window</p><h2>Two snapshots bracket three overlapping events</h2></div>
        <span className="context-badge">Dates are context, not causal proof</span>
      </div>
      <div className="timeline-track">
        {data.timeline.map((event, index) => (
          <article className={`timeline-event kind-${event.kind ?? 'policy'}`} key={event.id}>
            <div className="timeline-node"><span>{index + 1}</span></div>
            <time>{shortDate(event.date)}</time>
            <h3>{event.title}</h3>
            <p>{event.description}</p>
            {event.sourceUrl && <a href={event.sourceUrl} target="_blank" rel="noreferrer">{event.sourceLabel ?? 'Official source'}<ExternalLink size={12} /></a>}
          </article>
        ))}
      </div>
    </section>
  )
}

function Drivers({ data }: { data: PolicyMapPayload }) {
  const rawComponents = data.componentChanges.filter((item) => item.component !== 'adjusted')
  const weightedContribution: Record<string, number> = {
    individuals: 1,
    tentsStructures: 1.75,
    vehicles: 2.03,
  }
  const contributions = rawComponents.map((item) => ({
    ...item,
    contribution: item.delta * weightedContribution[item.component],
  }))
  const maxContribution = Math.max(...contributions.map((item) => Math.abs(item.contribution)), 1)
  const maxArea = Math.max(...data.areaChanges.map((item) => Math.abs(item.delta)), 1)
  return (
    <section className="drivers-grid">
      <article className="evidence-panel">
        <div className="panel-title"><div><p className="section-kicker">What drove the weighted decline?</p><h2>Structures fell. Individual marks rose.</h2></div><Tent size={22} /></div>
        <p className="panel-lede">The headline −332.7 is a formula, not a direct count of unique people. Its pieces moved in opposite directions.</p>
        <div className="contribution-list">
          {contributions.map((item) => (
            <div className="contribution-row" key={item.component}>
              <div className="contribution-label"><strong>{item.label}</strong><span>{whole.format(item.before)} → {whole.format(item.after)} raw marks</span></div>
              <div className="contribution-bar"><i className={item.contribution < 0 ? 'bar-negative' : 'bar-positive'} style={{ width: `${Math.max(4, Math.abs(item.contribution) / maxContribution * 100)}%` }} /></div>
              <strong className={item.contribution < 0 ? 'decrease-text' : 'increase-text'}>{signed(item.contribution)} <small>weighted</small></strong>
            </div>
          ))}
        </div>
        <div className="finding-callout"><AlertTriangle size={18} /><p><strong>Do not say “homelessness fell 25%.”</strong> Recorded individuals increased 20%, while tent/structure marks fell 45.1% and vehicle marks fell 69.7%.</p></div>
      </article>

      <article className="evidence-panel">
        <div className="panel-title"><div><p className="section-kicker">Where did the net change come from?</p><h2>East Village dominates the result</h2></div><MapPin size={22} /></div>
        <p className="panel-lede">The same 261 blocks are used in both snapshots, so changing geographic coverage cannot create this pattern.</p>
        <div className="area-change-list">
          {data.areaChanges.map((area) => (
            <div className="area-change-row" key={area.area}>
              <div><strong>{area.area}</strong><span>{signed(area.percentChange ?? 0, '%')}</span></div>
              <div className="area-bar"><i className={area.delta < 0 ? 'bar-negative' : 'bar-positive'} style={{ width: `${Math.max(3, Math.abs(area.delta) / maxArea * 100)}%` }} /></div>
              <strong className={area.delta < 0 ? 'decrease-text' : 'increase-text'}>{signed(area.delta)}</strong>
            </div>
          ))}
        </div>
        <p className="area-takeaway"><strong>85.2%</strong> of the net weighted decline came from East Village. Cortez moved the other direction.</p>
      </article>
    </section>
  )
}

function EvidenceLimits({ data }: { data: PolicyMapPayload }) {
  return (
    <section className="limits-section">
      <div className="limits-heading">
        <p className="section-kicker">The honest answer to “where did people go?”</p>
        <h2>The map shows where observations changed. It cannot trace movement.</h2>
        <p>San Diego’s own performance audit reached the same limit. That makes the missing evidence part of the finding—not something to hide.</p>
      </div>
      <div className="audit-grid">
        {data.auditorFindings.map((finding) => (
          <article className="audit-card" key={finding.id}>
            <strong>{finding.metric}</strong>
            <h3>{finding.title}</h3>
            <p>{finding.detail}</p>
            <a href={finding.sourceUrl} target="_blank" rel="noreferrer">{finding.sourceLabel}<ExternalLink size={12} /></a>
          </article>
        ))}
        <article className="audit-card unavailable-card">
          <div className="unavailable-pill"><ShieldAlert size={14} /> Not plotted</div>
          <h3>{data.enforcementLayer.title}</h3>
          <p>{data.enforcementLayer.explanation}</p>
          {data.enforcementLayer.alternativeLabel && <small>{data.enforcementLayer.alternativeLabel}</small>}
          {data.enforcementLayer.sourceUrl && <a href={data.enforcementLayer.sourceUrl} target="_blank" rel="noreferrer">{data.enforcementLayer.sourceLabel ?? 'Method source'}<ExternalLink size={12} /></a>}
        </article>
      </div>
      <div className="limits-conclusion">
        <div><Eye size={18} /><span><strong>Supported:</strong> where block observations increased or decreased.</span></div>
        <div><Tent size={18} /><span><strong>Supported:</strong> where the two Safe Sleeping sites are and when they opened.</span></div>
        <div><ShieldAlert size={18} /><span><strong>Not supported:</strong> claiming a person moved to a site or was displaced by enforcement.</span></div>
      </div>
    </section>
  )
}

function App() {
  const [data, setData] = useState<PolicyMapPayload>(policyMapFixture)
  const [sourceMode, setSourceMode] = useState<SourceMode>('loading')

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${API_BASE}/api/policy-map`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`API returned ${response.status}`)
        return response.json() as Promise<PolicyMapPayload>
      })
      .then((payload) => {
        setData(payload)
        setSourceMode('live')
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setSourceMode('fixture')
      })
    return () => controller.abort()
  }, [])

  const components = Object.fromEntries(data.componentChanges.map((item) => [item.component, item]))
  const scrollToMap = () => document.getElementById('change-map')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <header className="topbar">
        <a className="brand" href="#top" aria-label="StreetShift SD home">
          <span className="brand-mark"><MapPin size={20} /></span>
          <span><strong>StreetShift</strong><small>San Diego</small></span>
        </a>
        <div className="topbar-question">Policy-period evidence map</div>
        <div className={`source-state mode-${sourceMode}`}><span />{sourceMode === 'live' ? 'Organizer data live' : sourceMode === 'loading' ? 'Loading 261 blocks' : 'Offline fixture'}</div>
      </header>
      {sourceMode === 'fixture' && <div className="offline-banner"><AlertTriangle size={15} /> Backend unavailable. The interface is using labeled schematic geometry; run <code>./scripts/dev.sh</code> for the real block map.</div>}

      <main id="top">
        <section className="hero-section">
          <div className="hero-copy">
            <p className="eyebrow">San Diego · one year · same 261 Downtown blocks</p>
            <h1>What changed after the <em>2023 policy rollout?</em></h1>
            <p className="hero-description">A block-by-block comparison using the organizer-labeled count dates <strong>{fullDate(data.comparison.before.countDate)}</strong> and <strong>{fullDate(data.comparison.after.countDate)}</strong>, with Safe Sleeping locations and official policy dates placed on the same evidence timeline.</p>
            <div className="hero-actions">
              <button className="primary-button" onClick={scrollToMap}>Explore the block map <ArrowRight size={15} /></button>
              <a className="secondary-link" href="#evidence-limits">What the data cannot prove</a>
            </div>
          </div>
          <div className="comparison-card">
            <div className="comparison-date before-date"><span>Before snapshot</span><strong>{shortDate(data.comparison.before.countDate)}</strong><small>organizer-labeled count date</small></div>
            <div className="comparison-arrow"><ArrowRight size={21} /><span>{data.comparison.daysApart} days</span></div>
            <div className="comparison-date after-date"><span>After snapshot</span><strong>{shortDate(data.comparison.after.countDate)}</strong><small>organizer-labeled count date</small></div>
            <div className="comparison-rule"><CalendarDays size={16} /><p>Not January 1. <strong>Report month</strong> is a monthly label; <strong>count date</strong> is the date stored for the observation.</p></div>
          </div>
        </section>

        <section className="headline-metrics" aria-label="Headline changes">
          <article className="metric-card weighted-metric"><div><Database size={18} /><span>Weighted observed</span></div><strong>{signed(data.summary.percentChange, '%')}</strong><small>{number.format(data.summary.before)} → {number.format(data.summary.after)} people-equivalent</small></article>
          <article className="metric-card"><div><Users size={18} /><span>Individual marks</span></div><strong className="increase-text">{signed(components.individuals?.percentChange ?? 0, '%')}</strong><small>{whole.format(components.individuals?.before ?? 0)} → {whole.format(components.individuals?.after ?? 0)} recorded marks</small></article>
          <article className="metric-card"><div><Tent size={18} /><span>Structure marks</span></div><strong className="decrease-text">{signed(components.tentsStructures?.percentChange ?? 0, '%')}</strong><small>{whole.format(components.tentsStructures?.before ?? 0)} → {whole.format(components.tentsStructures?.after ?? 0)} recorded marks</small></article>
          <article className="metric-card"><div><Car size={18} /><span>Vehicle marks</span></div><strong className="decrease-text">{signed(components.vehicles?.percentChange ?? 0, '%')}</strong><small>{whole.format(components.vehicles?.before ?? 0)} → {whole.format(components.vehicles?.after ?? 0)} recorded marks</small></article>
        </section>

        <ChangeMap data={data} />
        <Timeline data={data} />
        <Drivers data={data} />
        <div id="evidence-limits"><EvidenceLimits data={data} /></div>

        <section className="method-strip">
          <div><p className="section-kicker">What is being calculated?</p><h2>One transparent formula, applied block by block</h2></div>
          <code>{data.comparison.formula}</code>
          <p>{data.comparison.interpretation} {data.caveat}</p>
        </section>
      </main>

      <footer>
        <div><strong>StreetShift SD</strong><span>Observed unsheltered-count evidence · no identities · no enforcement recommendations</span></div>
        <div className="footer-sources">
          {data.sources.slice(0, 4).map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.label}<ExternalLink size={11} /></a>)}
        </div>
      </footer>
    </div>
  )
}

export default App
