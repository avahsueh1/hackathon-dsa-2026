import type { PolicyMapFeature, PolicyMapPayload } from '../types'

const areas = ['East Village', 'City Center', 'Columbia', 'Marina', 'Cortez', 'Gaslamp']

const fixtureFeatures: PolicyMapFeature[] = Array.from({ length: 261 }, (_, index) => {
  const column = index % 19
  const row = Math.floor(index / 19)
  const x = -117.174 + column * 0.0012 + (row % 2) * 0.00022
  const y = 32.728 - row * 0.00105
  const individualsBefore = index % 7 === 0 ? 2 : index % 4 === 0 ? 1 : 0
  const individualsDelta = index % 13 === 0 ? 2 : index % 9 === 0 ? -1 : 0
  const tentsBefore = index % 6 === 0 ? 3 : index % 3 === 0 ? 1 : 0
  const tentsDelta = index < 93 ? -Math.min(tentsBefore, 1 + (index % 2)) : index < 171 && index % 5 === 0 ? 1 : 0
  const vehiclesBefore = index % 22 === 0 ? 1 : 0
  const vehiclesDelta = index < 93 ? -vehiclesBefore : index % 47 === 0 ? 1 : 0
  const before = {
    individuals: individualsBefore,
    tentsStructures: tentsBefore,
    vehicles: vehiclesBefore,
    adjusted: individualsBefore + 1.75 * tentsBefore + 2.03 * vehiclesBefore,
  }
  const after = {
    individuals: Math.max(0, individualsBefore + individualsDelta),
    tentsStructures: Math.max(0, tentsBefore + tentsDelta),
    vehicles: Math.max(0, vehiclesBefore + vehiclesDelta),
    adjusted: 0,
  }
  after.adjusted = after.individuals + 1.75 * after.tentsStructures + 2.03 * after.vehicles
  const delta = {
    individuals: after.individuals - before.individuals,
    tentsStructures: after.tentsStructures - before.tentsStructures,
    vehicles: after.vehicles - before.vehicles,
    adjusted: after.adjusted - before.adjusted,
  }
  const directionFor = (value: number) => value < 0 ? 'down' as const : value > 0 ? 'up' as const : 'unchanged' as const
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[x, y], [x + 0.00102, y], [x + 0.00102, y - 0.00087], [x, y - 0.00087], [x, y]]],
    },
    properties: {
      blockId: `fixture-${String(index + 1).padStart(3, '0')}`,
      area: areas[index % areas.length],
      before,
      after,
      delta,
      direction: {
        adjusted: directionFor(delta.adjusted),
        individuals: directionFor(delta.individuals),
        tentsStructures: directionFor(delta.tentsStructures),
        vehicles: directionFor(delta.vehicles),
      },
    },
  }
})

export const policyMapFixture: PolicyMapPayload = {
  title: 'Where did Downtown observations change after the 2023 policy rollout?',
  design: 'descriptive_before_after_balanced_panel',
  comparison: {
    before: { reportMonth: '2023-01-01', countDate: '2023-01-31', label: 'Organizer-labeled count date' },
    after: { reportMonth: '2024-01-01', countDate: '2024-01-25', label: 'Organizer-labeled count date' },
    daysApart: 359,
    panelBlocks: 261,
    formula: 'individuals + 1.75 × tents / structures + 2.03 × vehicles',
    interpretation: 'The map displays after minus before for the same 261 blocks.',
  },
  summary: { before: 1314.49, after: 981.8, delta: -332.69, percentChange: -25.31, blocksDown: 93, blocksUp: 78, blocksUnchanged: 90 },
  componentChanges: [
    { component: 'individuals', label: 'Recorded individuals', before: 425, after: 510, delta: 85, percentChange: 20 },
    { component: 'tentsStructures', label: 'Tent / structure marks', before: 470, after: 258, delta: -212, percentChange: -45.1 },
    { component: 'vehicles', label: 'Vehicle marks', before: 33, after: 10, delta: -23, percentChange: -69.7 },
    { component: 'adjusted', label: 'Weighted observed count', before: 1314.49, after: 981.8, delta: -332.69, percentChange: -25.31 },
  ],
  areaChanges: [
    { area: 'East Village', before: 810, after: 526.71, delta: -283.29, percentChange: -34.97, netSharePercent: 85.2 },
    { area: 'City Center', before: 270.25, after: 197.5, delta: -72.75, percentChange: -26.92, netSharePercent: 21.9 },
    { area: 'Marina', before: 23.06, after: 19, delta: -4.06, percentChange: -17.61, netSharePercent: 1.2 },
    { area: 'Columbia', before: 36.28, after: 33.5, delta: -2.78, percentChange: -7.66, netSharePercent: 0.8 },
    { area: 'Gaslamp', before: 45.5, after: 47, delta: 1.5, percentChange: 3.3, netSharePercent: -0.5 },
    { area: 'Cortez', before: 129.4, after: 158.09, delta: 28.69, percentChange: 22.17, netSharePercent: -8.6 },
  ],
  timeline: [
    { id: 'before', date: '2023-01-31', title: 'Before snapshot', description: 'Organizer-labeled block count date.', kind: 'observation' },
    { id: '20th-b', date: '2023-06-30', title: '20th & B began accepting clients', description: 'First Safe Sleeping site opened with 136 tent spaces.', kind: 'site', sourceLabel: 'City of San Diego', sourceUrl: 'https://www.sandiego.gov/outreach2-article/mayor-gloria-announces-opening-first-safe-sleeping-site-san-diegans-experiencing' },
    { id: 'ordinance', date: '2023-07-31', title: 'Ordinance enforcement began', description: 'The City began its scaled approach after outreach and education.', kind: 'policy', sourceLabel: 'City of San Diego', sourceUrl: 'https://www.sandiego.gov/police/services/neighborhood-policing-division/unsafe-camping' },
    { id: 'o-lot', date: '2023-10-21', title: 'O Lot began intakes', description: 'The second Safe Sleeping site began accepting clients.', kind: 'site', sourceLabel: 'City of San Diego', sourceUrl: 'https://www.sandiego.gov/mayor/mayor-gloria-opens-second-safe-sleeping-site-unsheltered-san-diegans' },
    { id: 'after', date: '2024-01-25', title: 'After snapshot', description: 'Organizer-labeled block count date.', kind: 'observation' },
  ],
  geojson: { type: 'FeatureCollection', features: fixtureFeatures },
  safeSleepingSites: [
    { id: '20th-b', name: '20th & B Safe Sleeping', latitude: 32.71829182, longitude: -117.14614399, address: '2145 Caminito Centro (City yard: 1970 B St)', openedDate: '2023-06-30', openingLabel: 'Began accepting clients June 29/30, 2023', capacityLabel: '136 tent spaces · up to 2 people per tent', outsidePanel: true, distanceToPanelMeters: 254, coordinateNote: 'Official City address point; not the precise tent centroid.', sourceLabel: 'City of San Diego', sourceUrl: 'https://docs.sandiego.gov/council_reso_ordinance/rao2024/R-315452.pdf' },
    { id: 'o-lot', name: 'O Lot Safe Sleeping', latitude: 32.72217185, longitude: -117.1475772, address: '1800 Welch Road, San Diego, CA 92101', openedDate: '2023-10-21', openingLabel: 'Began client intakes October 21, 2023', capacityLabel: 'Up to 400 tents at launch · up to 2 people per tent', outsidePanel: true, distanceToPanelMeters: 595, coordinateNote: 'Official City address point; not the precise tent centroid.', sourceLabel: 'City of San Diego', sourceUrl: 'https://www.sandiego.gov/sites/default/files/nora_o_lot_license_agreement.pdf' },
  ],
  ordinanceOffenseLayer: {
    available: true,
    label: 'Police-recorded ordinance offenses',
    description: 'SDPD NIBRS case records whose code section begins 63.0404, rounded and clustered near the study area.',
    sourceSnapshot: '2026-08-20',
    policyWindow: { start: '2023-07-31', end: '2024-01-25' },
    citywideRecordCount: 29,
    citywideUniqueCases: 29,
    validCoordinateCount: 29,
    within500mOfPanelCount: 7,
    nearbyClusterCount: 6,
    clusters: [
      { id: 'ordinance-cluster-01', latitude: 32.723, longitude: -117.141, recordCount: 2, firstDate: '2023-08-08', lastDate: '2023-12-24', subsection: '63.0404(c)', neighborhood: 'Balboa Park' },
      { id: 'ordinance-cluster-02', latitude: 32.720, longitude: -117.140, recordCount: 1, firstDate: '2023-08-09', lastDate: '2023-08-09', subsection: '63.0404(c)', neighborhood: 'Golden Hill' },
      { id: 'ordinance-cluster-03', latitude: 32.718, longitude: -117.149, recordCount: 1, firstDate: '2023-08-21', lastDate: '2023-08-21', subsection: '63.0404(c)', neighborhood: 'East Village' },
      { id: 'ordinance-cluster-04', latitude: 32.725, longitude: -117.158, recordCount: 1, firstDate: '2023-11-03', lastDate: '2023-11-03', subsection: '63.0404(c)', neighborhood: 'Balboa Park' },
      { id: 'ordinance-cluster-05', latitude: 32.702, longitude: -117.144, recordCount: 1, firstDate: '2023-12-31', lastDate: '2023-12-31', subsection: '63.0404(a)', neighborhood: 'Barrio Logan' },
      { id: 'ordinance-cluster-06', latitude: 32.726, longitude: -117.158, recordCount: 1, firstDate: '2024-01-06', lastDate: '2024-01-06', subsection: '63.0404(c)', neighborhood: 'Balboa Park' },
    ],
    caveat: 'These are not raid, citation, arrest, outreach, or encampment-removal locations. One record does not necessarily represent one person.',
    sourceLabel: 'City of San Diego — Police NIBRS Crime Offenses',
    sourceUrl: 'https://data.sandiego.gov/datasets/police-nibrs/',
  },
  enforcementLayer: {
    available: false,
    title: 'Event-level enforcement locations are not public',
    explanation: 'The City Auditor analyzed police records supplied internally, but no public row-level dataset was found. Get It Done points are resident reports—not raids, citations, or confirmed abatements.',
    alternativeLabel: 'Public encampment reports are a separate proxy and are not plotted as enforcement.',
    sourceLabel: 'City Auditor, 2026',
    sourceUrl: 'https://www.sandiego.gov/sites/default/files/2026-04/performance-audit-of-the-city-s-response-to-homeless-encampments-since-the-unsafe-camping-ordinance.pdf',
  },
  auditorFindings: [
    { id: 'movement', metric: 'Not traceable', title: 'The City could not determine where people moved', detail: 'The official audit says available data cannot establish specific geographic movement within the City.', sourceLabel: 'City Auditor, 2026', sourceUrl: 'https://www.sandiego.gov/sites/default/files/2026-04/performance-audit-of-the-city-s-response-to-homeless-encampments-since-the-unsafe-camping-ordinance.pdf' },
    { id: 'reports', metric: '+45%', title: 'Downtown encampment reports increased', detail: 'Get It Done encampment reports rose by 6,938 in the two years after versus the two years before the ordinance.', sourceLabel: 'City Auditor, 2026', sourceUrl: 'https://www.sandiego.gov/sites/default/files/2026-04/performance-audit-of-the-city-s-response-to-homeless-encampments-since-the-unsafe-camping-ordinance.pdf' },
  ],
  sources: [
    { id: 'organizer', label: 'Building for Good organizer block dataset', url: 'https://drive.google.com/drive/folders/1cJ6_sIiJ8FG_IqZ7LN4ET__ZR_N8yWwv' },
    { id: 'audit', label: 'City Auditor performance audit', url: 'https://www.sandiego.gov/sites/default/files/2026-04/performance-audit-of-the-city-s-response-to-homeless-encampments-since-the-unsafe-camping-ordinance.pdf' },
  ],
  caveat: 'This is a descriptive before/after comparison. It does not identify people, trace movement, or isolate the effect of any one policy.',
}
