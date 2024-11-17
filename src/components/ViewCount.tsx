import { useState, useEffect } from "react";

export interface Props {
  postUrl: string;
}

export default function ViewCount({ postUrl }: Props) {
  const [viewCount, setViewCount] = useState(0);
  const post = postUrl.substring(postUrl.lastIndexOf("/") + 1);

  useEffect(() => {
    const getViewCount = async () => {
      try {
        const resp = await fetch(`/api/views${postUrl}`);
        if (resp.ok) {
          const count = await resp.json();
          setViewCount(count);
        } else setViewCount(viewCount + 1);
      } catch (e) {
        console.error(`Error: ` + e);
      }
      console.log("Heard Back!");
    };

    getViewCount();

    return () => {
      fetch(`/api/views/${post}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
      }).catch(e => console.error(`Error updating views: ` + e));
    };
  }, []);

  return <span>Viewed {viewCount} times</span>;
}
