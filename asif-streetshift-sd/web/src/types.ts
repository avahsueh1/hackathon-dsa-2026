export type PolicyMetric = 'adjusted' | 'individuals' | 'tentsStructures' | 'vehicles'

export interface CountBreakdown {
  individuals: number
  tentsStructures: number
  vehicles: number
  adjusted: number
}

export interface PolicyMapBlockProperties {
  blockId: string | number
  area: string
  before: CountBreakdown
  after: CountBreakdown
  delta: CountBreakdown
  direction: Record<PolicyMetric, 'down' | 'up' | 'unchanged'>
}

export interface PolicyMapFeature {
  type: 'Feature'
  geometry: {
    type: 'Polygon' | 'MultiPolygon'
    coordinates: number[][][] | number[][][][]
  }
  properties: PolicyMapBlockProperties
}

export interface SafeSleepingSite {
  id: string
  name: string
  latitude: number
  longitude: number
  address: string
  openedDate: string
  openingLabel: string
  capacityLabel: string
  outsidePanel: boolean
  distanceToPanelMeters?: number
  coordinateNote?: string
  sourceUrl: string
  sourceLabel: string
}

export interface OrdinanceOffenseCluster {
  id: string
  latitude: number
  longitude: number
  recordCount: number
  firstDate: string
  lastDate: string
  subsection: string
  neighborhood: string
}

export interface PolicyMapPayload {
  title: string
  design: string
  comparison: {
    before: { reportMonth: string; countDate: string; label: string }
    after: { reportMonth: string; countDate: string; label: string }
    daysApart: number
    panelBlocks: number
    formula: string
    interpretation: string
  }
  summary: {
    before: number
    after: number
    delta: number
    percentChange: number
    blocksDown: number
    blocksUp: number
    blocksUnchanged: number
  }
  componentChanges: Array<{
    component: PolicyMetric
    label: string
    before: number
    after: number
    delta: number
    percentChange: number | null
  }>
  areaChanges: Array<{
    area: string
    before: number
    after: number
    delta: number
    percentChange: number | null
    netSharePercent?: number | null
  }>
  timeline: Array<{
    id: string
    date: string
    title: string
    description: string
    sourceUrl?: string
    sourceLabel?: string
    kind?: 'observation' | 'site' | 'policy'
  }>
  geojson: { type: 'FeatureCollection'; features: PolicyMapFeature[] }
  safeSleepingSites: SafeSleepingSite[] | {
    type: 'FeatureCollection'
    features: Array<{
      type: 'Feature'
      geometry: { type: 'Point'; coordinates: [number, number] }
      properties: Omit<SafeSleepingSite, 'latitude' | 'longitude'>
    }>
  }
  ordinanceOffenseLayer: {
    available: boolean
    label: string
    description: string
    sourceSnapshot: string
    policyWindow: { start: string; end: string }
    citywideRecordCount: number
    citywideUniqueCases: number
    validCoordinateCount: number
    within500mOfPanelCount: number
    nearbyClusterCount: number
    clusters: OrdinanceOffenseCluster[]
    caveat: string
    sourceLabel: string
    sourceUrl: string
    sourceFiles?: string[]
  }
  enforcementLayer: {
    available: boolean
    title: string
    explanation: string
    alternativeLabel?: string
    sourceUrl?: string
    sourceLabel?: string
  }
  auditorFindings: Array<{
    id: string
    metric: string
    title: string
    detail: string
    sourceUrl: string
    sourceLabel: string
  }>
  sources: Array<{ id: string; label: string; url: string }>
  caveat: string
}
