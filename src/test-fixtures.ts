import type { OfficialStore } from "./api";

export function makeStore(overrides: Partial<OfficialStore> = {}): OfficialStore {
  return {
    oldPKey: "018558",
    name: "全家台鐵西店",
    address: "台北市中正區北平西路３號",
    latitude: 25.047203,
    longitude: 121.517044,
    distance: 77.7,
    updateDate: "2026-10-04T03:40:44+08:00",
    info: [
      {
        name: "美味挖寶",
        categories: [
          {
            name: "美味挖寶",
            products: [
              { name: "惜—北海道玉米濃湯洋芋片", qty: 2 },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}
