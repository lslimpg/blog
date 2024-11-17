export interface Props {
  src: string;
}
export default function Media({ src }: Props) {
  return (
    <>
      <div style={{ display: "flex", height: "518px" }}>
        <iframe
          allow="fullscreen"
          loading="lazy"
          width="100%"
          height="100%"
          src={src}
        ></iframe>
      </div>
    </>
  );
}
