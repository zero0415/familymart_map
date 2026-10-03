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
