import type { ComponentProps } from "react";

const paths = {
  close: "M6 6l12 12M6 18 18 6",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  lock: "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3",
  check: "m5 12 4 4L19 6",
  phone:
    "M8 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-4l-5-2-2 2a15 15 0 0 1-6-6l2-2z",
  wallet: "M19 7V4H4a2 2 0 0 0 0 4h17v12H4a2 2 0 0 1-2-2V6m19 6h-5v4h5",
  document: "M14 2H5v20h14V7zM14 2v5h5M8 12h8M8 16h6",
  plus: "M12 5v14M5 12h14",
} as const;

export function Icon({
  name,
  ...props
}: ComponentProps<"svg"> & { name: keyof typeof paths }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
