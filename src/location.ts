import type { Coordinates } from "./api";

export interface AreaPreset extends Coordinates {
  id: string;
  label: string;
}

export const AREA_PRESETS: readonly AreaPreset[] = [
  { id: "taipei", label: "臺北市中正區・臺北車站", latitude: 25.0479, longitude: 121.5171 },
  { id: "xinyi", label: "臺北市信義區・市政府", latitude: 25.0411, longitude: 121.5651 },
  { id: "banqiao", label: "新北市板橋區・板橋車站", latitude: 25.0142, longitude: 121.4637 },
  { id: "taoyuan", label: "桃園市桃園區・桃園車站", latitude: 24.9894, longitude: 121.3136 },
  { id: "hsinchu", label: "新竹市東區・新竹車站", latitude: 24.8016, longitude: 120.9717 },
  { id: "taichung", label: "臺中市中區・臺中車站", latitude: 24.1368, longitude: 120.6853 },
  { id: "tainan", label: "臺南市中西區・臺南車站", latitude: 22.997, longitude: 120.2129 },
  { id: "kaohsiung", label: "高雄市三民區・高雄車站", latitude: 22.6396, longitude: 120.302 },
  { id: "yilan", label: "宜蘭縣宜蘭市・宜蘭車站", latitude: 24.7555, longitude: 121.7586 },
  { id: "hualien", label: "花蓮縣花蓮市・花蓮車站", latitude: 23.9925, longitude: 121.6011 },
  { id: "kinmen", label: "金門縣金城鎮・市區", latitude: 24.4321, longitude: 118.3178 },
];

export const TAIPEI_MRT_STATION_SOURCE_URL = "https://data.gov.tw/dataset/131734";
export const TAIPEI_MRT_STATION_DATE = "2026-09-02";

// 臺北大眾捷運公司「臺北捷運車站資料」：僅取臺北市地址，轉乘站依首個站碼列一次。
export const TAIPEI_MRT_LINES: readonly {
  label: string;
  stations: readonly AreaPreset[];
}[] = [
  {
    label: "文湖線",
    stations: [
      { id: "mrt-br01", label: "動物園（捷運站）", latitude: 24.998205, longitude: 121.579501 },
      { id: "mrt-br02", label: "木柵（捷運站）", latitude: 24.99824, longitude: 121.573127 },
      { id: "mrt-br03", label: "萬芳社區（捷運站）", latitude: 24.99857, longitude: 121.568088 },
      { id: "mrt-br04", label: "萬芳醫院（捷運站）", latitude: 24.99932, longitude: 121.558092 },
      { id: "mrt-br05", label: "辛亥（捷運站）", latitude: 25.005455, longitude: 121.5570455 },
      { id: "mrt-br06", label: "麟光（捷運站）", latitude: 25.018495, longitude: 121.5588335 },
      { id: "mrt-br07", label: "六張犁（捷運站）", latitude: 25.02381, longitude: 121.55302 },
      { id: "mrt-br08", label: "科技大樓（捷運站）", latitude: 25.02612, longitude: 121.5434615 },
      { id: "mrt-br09", label: "大安（捷運站）", latitude: 25.033311, longitude: 121.54237 },
      { id: "mrt-br10", label: "忠孝復興（捷運站）", latitude: 25.041749, longitude: 121.545026 },
      { id: "mrt-br12", label: "中山國中（捷運站）", latitude: 25.06085, longitude: 121.544215 },
      { id: "mrt-br13", label: "松山機場（捷運站）", latitude: 25.0629075, longitude: 121.55201 },
      { id: "mrt-br14", label: "大直（捷運站）", latitude: 25.07943, longitude: 121.54679 },
      { id: "mrt-br15", label: "劍南路（捷運站）", latitude: 25.08483, longitude: 121.5555825 },
      { id: "mrt-br16", label: "西湖（捷運站）", latitude: 25.08216, longitude: 121.567227 },
      { id: "mrt-br17", label: "港墘（捷運站）", latitude: 25.08007, longitude: 121.57516 },
      { id: "mrt-br18", label: "文德（捷運站）", latitude: 25.078455, longitude: 121.5849995 },
      { id: "mrt-br19", label: "內湖（捷運站）", latitude: 25.083675, longitude: 121.594363 },
      { id: "mrt-br20", label: "大湖公園（捷運站）", latitude: 25.083805, longitude: 121.602214 },
      { id: "mrt-br21", label: "葫洲（捷運站）", latitude: 25.07271, longitude: 121.6071455 },
      { id: "mrt-br22", label: "東湖（捷運站）", latitude: 25.067455, longitude: 121.611535 },
      { id: "mrt-br23", label: "南港軟體園區（捷運站）", latitude: 25.05992, longitude: 121.615 },
      { id: "mrt-br24", label: "南港展覽館（捷運站）", latitude: 25.054919, longitude: 121.616861 },
    ],
  },
  {
    label: "淡水信義線",
    stations: [
      { id: "mrt-r01", label: "廣慈/奉天宮（捷運站）", latitude: 25.0375827, longitude: 121.581789 },
      { id: "mrt-r02", label: "象山（捷運站）", latitude: 25.032395, longitude: 121.570116 },
      { id: "mrt-r03", label: "台北101/世貿（捷運站）", latitude: 25.032865, longitude: 121.563667 },
      { id: "mrt-r04", label: "信義安和（捷運站）", latitude: 25.033015, longitude: 121.552326 },
      { id: "mrt-r06", label: "大安森林公園（捷運站）", latitude: 25.033225, longitude: 121.536151 },
      { id: "mrt-r07", label: "東門（捷運站）", latitude: 25.033894, longitude: 121.528766 },
      { id: "mrt-r08", label: "中正紀念堂（捷運站）", latitude: 25.032767, longitude: 121.518273 },
      { id: "mrt-r09", label: "台大醫院（捷運站）", latitude: 25.041399, longitude: 121.51602 },
      { id: "mrt-r10", label: "台北車站（捷運站）", latitude: 25.04631, longitude: 121.517415 },
      { id: "mrt-r11", label: "中山（捷運站）", latitude: 25.052621, longitude: 121.520364 },
      { id: "mrt-r12", label: "雙連（捷運站）", latitude: 25.057575, longitude: 121.520685 },
      { id: "mrt-r13", label: "民權西路（捷運站）", latitude: 25.06235, longitude: 121.519585 },
      { id: "mrt-r14", label: "圓山（捷運站）", latitude: 25.0714085, longitude: 121.520074 },
      { id: "mrt-r15", label: "劍潭（捷運站）", latitude: 25.0842015, longitude: 121.5249545 },
      { id: "mrt-r16", label: "士林（捷運站）", latitude: 25.0934925, longitude: 121.52623 },
      { id: "mrt-r17", label: "芝山（捷運站）", latitude: 25.102718, longitude: 121.522546 },
      { id: "mrt-r18", label: "明德（捷運站）", latitude: 25.109815, longitude: 121.518785 },
      { id: "mrt-r19", label: "石牌（捷運站）", latitude: 25.114455, longitude: 121.515572 },
      { id: "mrt-r20", label: "唭哩岸（捷運站）", latitude: 25.1208515, longitude: 121.506234 },
      { id: "mrt-r21", label: "奇岩（捷運站）", latitude: 25.1254705, longitude: 121.50114 },
      { id: "mrt-r22", label: "北投（捷運站）", latitude: 25.1318185, longitude: 121.4986475 },
      { id: "mrt-r22a", label: "新北投（捷運站）", latitude: 25.1369315, longitude: 121.5025955 },
      { id: "mrt-r23", label: "復興崗（捷運站）", latitude: 25.137497, longitude: 121.485456 },
      { id: "mrt-r24", label: "忠義（捷運站）", latitude: 25.1309225, longitude: 121.4732975 },
      { id: "mrt-r25", label: "關渡（捷運站）", latitude: 25.12551, longitude: 121.467 },
    ],
  },
  {
    label: "松山新店線",
    stations: [
      { id: "mrt-g05", label: "景美（捷運站）", latitude: 24.992824, longitude: 121.5406975 },
      { id: "mrt-g06", label: "萬隆（捷運站）", latitude: 25.001978, longitude: 121.539008 },
      { id: "mrt-g07", label: "公館（捷運站）", latitude: 25.014781, longitude: 121.534358 },
      { id: "mrt-g08", label: "台電大樓（捷運站）", latitude: 25.020733, longitude: 121.5281435 },
      { id: "mrt-g09", label: "古亭（捷運站）", latitude: 25.026373, longitude: 121.522868 },
      { id: "mrt-g11", label: "小南門（捷運站）", latitude: 25.035585, longitude: 121.51088 },
      { id: "mrt-g13", label: "北門（捷運站）", latitude: 25.049554, longitude: 121.510184 },
      { id: "mrt-g15", label: "松江南京（捷運站）", latitude: 25.052693, longitude: 121.53285 },
      { id: "mrt-g16", label: "南京復興（捷運站）", latitude: 25.052044, longitude: 121.544303 },
      { id: "mrt-g17", label: "台北小巨蛋（捷運站）", latitude: 25.05152, longitude: 121.552549 },
      { id: "mrt-g18", label: "南京三民（捷運站）", latitude: 25.051588, longitude: 121.56471 },
      { id: "mrt-g19", label: "松山（捷運站）", latitude: 25.050118, longitude: 121.577706 },
    ],
  },
  {
    label: "中和新蘆線",
    stations: [
      { id: "mrt-o09", label: "行天宮（捷運站）", latitude: 25.05924, longitude: 121.53315 },
      { id: "mrt-o10", label: "中山國小（捷運站）", latitude: 25.062665, longitude: 121.526609 },
      { id: "mrt-o12", label: "大橋頭（捷運站）", latitude: 25.06322, longitude: 121.5130035 },
    ],
  },
  {
    label: "板南線",
    stations: [
      { id: "mrt-bl10", label: "龍山寺（捷運站）", latitude: 25.03528, longitude: 121.500325 },
      { id: "mrt-bl11", label: "西門（捷運站）", latitude: 25.042025, longitude: 121.508175 },
      { id: "mrt-bl13", label: "善導寺（捷運站）", latitude: 25.04468, longitude: 121.523885 },
      { id: "mrt-bl14", label: "忠孝新生（捷運站）", latitude: 25.042498, longitude: 121.53321 },
      { id: "mrt-bl16", label: "忠孝敦化（捷運站）", latitude: 25.041505, longitude: 121.55045 },
      { id: "mrt-bl17", label: "國父紀念館（捷運站）", latitude: 25.04137, longitude: 121.557815 },
      { id: "mrt-bl18", label: "市政府（捷運站）", latitude: 25.041135, longitude: 121.565685 },
      { id: "mrt-bl19", label: "永春（捷運站）", latitude: 25.040855, longitude: 121.5762 },
      { id: "mrt-bl20", label: "後山埤（捷運站）", latitude: 25.044715, longitude: 121.58227 },
      { id: "mrt-bl21", label: "昆陽（捷運站）", latitude: 25.0504585, longitude: 121.5932285 },
      { id: "mrt-bl22", label: "南港（捷運站）", latitude: 25.052035, longitude: 121.60697 },
    ],
  },
];

export const TAIPEI_MRT_STATIONS: readonly AreaPreset[] =
  TAIPEI_MRT_LINES.flatMap(({ stations }) => stations);

export const FAVORITES_REFERENCE_POSITION: Coordinates = {
  latitude: 25.0479,
  longitude: 121.5171,
};

export type GeolocationClient = Pick<Geolocation, "getCurrentPosition">;

export class LocationError extends Error {
  constructor(
    public readonly kind: "unavailable" | "denied" | "timeout" | "position" | "invalid",
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "LocationError";
  }
}

export function parseCoordinates(latitudeText: string, longitudeText: string): Coordinates {
  if (!latitudeText.trim() || !longitudeText.trim()) {
    throw new LocationError("invalid", "請填寫緯度與經度後再搜尋。");
  }
  const latitude = Number(latitudeText);
  const longitude = Number(longitudeText);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    throw new LocationError(
      "invalid",
      "座標無效；緯度須介於 -90～90、經度須介於 -180～180。",
    );
  }
  return { latitude, longitude };
}

export function requestLocation(
  geolocation: GeolocationClient | undefined,
): Promise<Coordinates> {
  if (!geolocation) {
    return Promise.reject(
      new LocationError(
        "unavailable",
        "此瀏覽器或連線環境不支援定位；可改用地區中心或手動座標搜尋。",
      ),
    );
  }

  return new Promise((resolve, reject) => {
    try {
      geolocation.getCurrentPosition(
        (position) => {
          try {
            resolve(
              parseCoordinates(
                String(position.coords.latitude),
                String(position.coords.longitude),
              ),
            );
          } catch (error) {
            reject(
              new LocationError(
                "invalid",
                "瀏覽器回傳無效的定位座標；可改用地區中心或手動座標搜尋。",
                error,
              ),
            );
          }
        },
        (error) => {
          if (error.code === 1) {
            reject(
              new LocationError(
                "denied",
                "未取得定位權限；不需要授權也能選擇地區中心或輸入座標搜尋。",
                error,
              ),
            );
          } else if (error.code === 3) {
            reject(
              new LocationError(
                "timeout",
                "定位逾時；可重試，或選擇地區中心／手動座標搜尋。",
                error,
              ),
            );
          } else {
            reject(
              new LocationError(
                "position",
                "目前無法取得定位；可選擇地區中心或手動座標搜尋。",
                error,
              ),
            );
          }
        },
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
      );
    } catch (error) {
      reject(
        new LocationError(
          "unavailable",
          "無法啟動瀏覽器定位；可選擇地區中心或手動座標搜尋。",
          error,
        ),
      );
    }
  });
}
