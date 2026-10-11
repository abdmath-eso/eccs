# Face models

The two model files the API uses for face attendance. They are **not kept in git** (about 39 MB); fetch them with:

```powershell
pnpm --filter @eccs/api face:models
```

Then restart the API. Without them the API still starts, and every face endpoint answers 503 with the code `FACE_ENGINE_UNAVAILABLE`.

| File | What it does | Licence | Size (bytes) | SHA-256 |
|---|---|---|---|---|
| `face_detection_yunet_2023mar.onnx` | YuNet: finds the faces in a photo and five points on each (eyes, nose tip, mouth corners) | MIT | 232,589 | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` |
| `face_recognition_sface_2021dec.onnx` | SFace: turns one face into a template of 128 numbers | Apache-2.0 | 38,696,353 | `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79` |

Where they come from (the official OpenCV model zoo):

- https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx (licence: https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/LICENSE)
- https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx (licence: https://github.com/opencv/opencv_zoo/blob/main/models/face_recognition_sface/LICENSE)

`manifest.json` in this folder holds the same list for the code: the download script reads the addresses from it, and the API checks each file against its SHA-256 every time it starts and refuses a file that does not match.

## Rules

- **Do not swap in other face models without checking the licence.** InsightFace's "buffalo" packs, EdgeFace and dlib's 68-point landmark model are free for research only and must not be used in ECCS.
- A template made by one recognition model cannot be compared with another model's. Changing the recogniser means every employee enrols again (the enrolment photos are not kept).
- On a server, put the files in this folder during deployment, or set `FACE_MODELS_DIR` to the folder they are in.
