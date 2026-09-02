declare module "gunzip-maybe" {
  import { Transform } from "node:stream";
  function gunzipMaybe(): Transform;
  export default gunzipMaybe;
}
