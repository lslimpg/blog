import { useState, useEffect } from "react";
import type { CollectionEntry } from "astro:content";

export interface Props {
  title: string;
}

export default function ViewCount({ title }: Props) {
  const [viewCount, setViewCount] = useState(0);

  useEffect(() => {
    const getViewCount = async () => {
      try {
        const resp = await fetch(`/api/views/${title}`);
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
      fetch(`/api/views/${title}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
      }).catch(e => console.error(`Error updating views: ` + e));
    };
  }, []);

  return <span>Viewed {viewCount} times</span>;
}
