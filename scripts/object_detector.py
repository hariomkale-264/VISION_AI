"""
Open-Vocabulary Object Detector using Gemini 2.5 Flash

Detects custom classes not limited to standard COCO-80, including:
person, bike, car, water bottle, bag, wall, stairs, door, laptop, phone, mouse,
book, animals (dog, cat, cow, bird, etc.), and tree.

Accepts:
- Single image file:   python scripts/object_detector.py --image path/to/image.jpg
- Video file:          python scripts/object_detector.py --video path/to/video.mp4 --skip 5
- Live webcam feed:    python scripts/object_detector.py --webcam 0 --skip 3
"""

import os
import sys
import json
import time
import argparse
from typing import List, Dict, Any, Optional

try:
    import cv2
except ImportError:
    cv2 = None

try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None
    types = None

# ==============================================================================
# CONFIGURATION: Target Class List
# Edit this single list to add or remove detectable objects.
# ==============================================================================
TARGET_CLASSES: List[str] = [
    "person",
    "bike",
    "car",
    "water bottle",
    "bag",
    "wall",
    "stairs",
    "door",
    "laptop",
    "phone",
    "mouse",
    "book",
    "animal",  # Detected with specific species, e.g. "animal (dog)", "animal (cat)", "animal (cow)", "animal (bird)"
    "tree",
]

# Model name: gemini-2.5-flash or newer
DEFAULT_MODEL = "gemini-2.5-flash"

SYSTEM_PROMPT = f"""You are an ultra-accurate open-vocabulary vision object detector.
Your task is to detect ALL visible instances of objects in the provided frame belonging to this target list:
{json.dumps(TARGET_CLASSES)}

Rules:
1. Detect every visible instance, including small, partial, occluded, background, and overlapping objects.
2. For animals, return "animal (<species>)" as the label (e.g., "animal (dog)", "animal (cat)", "animal (cow)", "animal (bird)").
3. For architectural and environmental elements like "wall", "stairs", "door", "tree", accurately bound their primary visible extent.
4. For all other classes, use the exact label name from the target list:
   - "person"
   - "bike"
   - "car"
   - "water bottle"
   - "bag"
   - "laptop"
   - "phone"
   - "mouse"
   - "book"
   - "stairs"
   - "door"
   - "wall"
   - "tree"
5. Do NOT output objects outside of the target categories.
6. Return bounding box coordinates normalized to [0, 1000] scale: [ymin, xmin, ymax, xmax].
7. Return a confidence score between 0.0 and 1.0.
8. Output ONLY a valid JSON array of objects. No markdown formatting, no explanation, no backticks.

Output format example:
[
  {{"box_2d": [120, 340, 560, 480], "label": "water bottle", "score": 0.94}},
  {{"box_2d": [45, 10, 890, 450], "label": "wall", "score": 0.88}}
]
"""

# Color palette for classes (BGR for OpenCV)
CLASS_COLORS = {
    "person": (255, 120, 0),
    "bike": (0, 200, 255),
    "car": (0, 50, 255),
    "water bottle": (255, 0, 180),
    "bag": (180, 0, 255),
    "wall": (120, 120, 120),
    "stairs": (200, 100, 0),
    "door": (150, 50, 200),
    "laptop": (50, 220, 50),
    "phone": (0, 165, 255),
    "mouse": (200, 200, 0),
    "book": (30, 180, 150),
    "animal": (0, 100, 255),
    "tree": (34, 139, 34),
}


def get_color_for_label(label: str) -> tuple:
    low = label.lower()
    for k, col in CLASS_COLORS.items():
        if k in low:
            return col
    # Default cyan-green
    return (0, 255, 180)


class GeminiDetector:
    def __init__(self, api_key: Optional[str] = None, model: str = DEFAULT_MODEL):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError(
                "GEMINI_API_KEY not found. Please set the GEMINI_API_KEY environment variable or pass --api-key."
            )
        if genai is None:
            raise ImportError(
                "google-genai package is not installed. Run: pip install google-genai"
            )

        self.client = genai.Client(api_key=self.api_key)
        self.model = model

    def detect_frame(self, frame_bgr) -> List[Dict[str, Any]]:
        """
        Encodes frame to JPEG, invokes Gemini model, and returns parsed detections list:
        [{ "box_2d": [ymin, xmin, ymax, xmax], "label": str, "score": float }]
        """
        # Encode image to JPEG in memory
        success, buffer = cv2.imencode(".jpg", frame_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        if not success:
            return []

        image_bytes = buffer.tobytes()

        try:
            response = self.client.models.generate_content(
                model=self.model,
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                    SYSTEM_PROMPT,
                ],
                config=types.GenerateContentConfig(
                    temperature=0.1,
                    response_mime_type="application/json",
                ),
            )

            text = response.text or ""
            # Clean possible markdown wrap
            cleaned_text = text.strip()
            if cleaned_text.startswith("```"):
                lines = cleaned_text.splitlines()
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].startswith("```"):
                    lines = lines[:-1]
                cleaned_text = "\n".join(lines).strip()

            detections = json.loads(cleaned_text)
            if isinstance(detections, list):
                return detections
            elif isinstance(detections, dict) and "detections" in detections:
                return detections["detections"]
            return []
        except Exception as e:
            print(f"[GeminiDetector Warning] Error during detection: {e}", file=sys.stderr)
            return []


def draw_detections(frame, detections: List[Dict[str, Any]], min_score: float = 0.3):
    """
    Renders bounding boxes and label tags onto the OpenCV frame.
    box_2d format: [ymin, xmin, ymax, xmax] normalized 0-1000.
    """
    height, width = frame.shape[:2]

    for det in detections:
        box = det.get("box_2d") or det.get("box") or det.get("bbox")
        label = det.get("label", "object")
        score = float(det.get("score", 0.0))

        if not box or len(box) != 4 or score < min_score:
            continue

        ymin, xmin, ymax, xmax = box
        # Denormalize from 0-1000 to image pixel dimensions
        x1 = int((xmin / 1000.0) * width)
        y1 = int((ymin / 1000.0) * height)
        x2 = int((xmax / 1000.0) * width)
        y2 = int((ymax / 1000.0) * height)

        color = get_color_for_label(label)
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

        # Label badge
        text = f"{label} {int(score * 100)}%"
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.55
        thickness = 1
        (tw, th), baseline = cv2.getTextSize(text, font, font_scale, thickness)

        badge_y1 = max(0, y1 - th - 8)
        badge_y2 = y1
        badge_x2 = min(width, x1 + tw + 8)

        cv2.rectangle(frame, (x1, badge_y1), (badge_x2, badge_y2), color, -1)
        cv2.putText(
            frame,
            text,
            (x1 + 4, y1 - 4),
            font,
            font_scale,
            (255, 255, 255),
            thickness,
            cv2.LINE_AA,
        )


def process_image(detector: GeminiDetector, image_path: str, output_path: Optional[str] = None):
    frame = cv2.imread(image_path)
    if frame is None:
        print(f"Error: Could not read image at {image_path}", file=sys.stderr)
        return

    print(f"Processing image {image_path}...")
    t0 = time.time()
    detections = detector.detect_frame(frame)
    latency = time.time() - t0
    print(f"Detected {len(detections)} objects in {latency:.2f}s:")
    for d in detections:
        print(f"  - {d.get('label')}: score={d.get('score')} box={d.get('box_2d')}")

    draw_detections(frame, detections)

    if output_path:
        cv2.imwrite(output_path, frame)
        print(f"Annotated image saved to {output_path}")
    else:
        cv2.imshow("Open-Vocabulary Detection (Gemini 2.5 Flash)", frame)
        print("Press any key to close...")
        cv2.waitKey(0)
        cv2.destroyAllWindows()


def process_video_or_webcam(
    detector: GeminiDetector,
    source: Any,
    skip_frames: int = 5,
    output_path: Optional[str] = None,
):
    """
    Processes video or live webcam.
    Sends frames to Gemini every Nth frame (skip_frames) to minimize cost and latency.
    Interpolates / caches current detections across interim frames.
    """
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        print(f"Error: Could not open video source {source}", file=sys.stderr)
        return

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    writer = None
    if output_path:
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(output_path, fourcc, fps, (width, height))

    frame_idx = 0
    cached_detections: List[Dict[str, Any]] = []

    print(f"Starting detection (sampling every {skip_frames} frames)... Press 'q' to quit.")

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Send to Gemini every Nth frame
        if frame_idx % skip_frames == 0:
            cached_detections = detector.detect_frame(frame)

        # Draw currently tracked detections
        draw_detections(frame, cached_detections)

        # Draw HUD info
        cv2.putText(
            frame,
            f"Active Objects: {len(cached_detections)} | Frame: {frame_idx}",
            (15, 30),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (0, 255, 0),
            2,
            cv2.LINE_AA,
        )

        if writer:
            writer.write(frame)
        else:
            cv2.imshow("Open-Vocabulary Detection (Gemini 2.5 Flash)", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

        frame_idx += 1

    cap.release()
    if writer:
        writer.release()
        print(f"Processed video written to {output_path}")
    cv2.destroyAllWindows()


def main():
    parser = argparse.ArgumentParser(description="Open-Vocabulary Object Detector using Gemini 2.5 Flash")
    parser.add_argument("--image", type=str, help="Path to input image file")
    parser.add_argument("--video", type=str, help="Path to input video file")
    parser.add_argument("--webcam", type=int, default=None, help="Webcam device index (e.g. 0)")
    parser.add_argument("--skip", type=int, default=5, help="Process every Nth frame to save cost (default 5)")
    parser.add_argument("--output", type=str, default=None, help="Optional output path for image or video")
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL, help=f"Gemini model (default: {DEFAULT_MODEL})")
    parser.add_argument("--api-key", type=str, default=None, help="Gemini API Key (or set GEMINI_API_KEY env)")

    args = parser.parse_args()

    if cv2 is None:
        print("Error: opencv-python is required. Run: pip install opencv-python", file=sys.stderr)
        sys.exit(1)

    try:
        detector = GeminiDetector(api_key=args.api_key, model=args.model)
    except Exception as e:
        print(f"Error initializing detector: {e}", file=sys.stderr)
        sys.exit(1)

    if args.image:
        process_image(detector, args.image, args.output)
    elif args.video:
        process_video_or_webcam(detector, args.video, skip_frames=args.skip, output_path=args.output)
    elif args.webcam is not None:
        process_video_or_webcam(detector, args.webcam, skip_frames=args.skip, output_path=args.output)
    else:
        print("Please provide --image, --video, or --webcam. Run with --help for details.")


if __name__ == "__main__":
    main()
