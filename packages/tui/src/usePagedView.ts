import { useEffect, useState } from 'react';
import { getPageWindow } from './pagination.js';

export function usePagedView(totalItems: number, pageSize: number, followEndInitially = false) {
  const [requestedPage, setRequestedPage] = useState(0);
  const [followingEnd, setFollowingEnd] = useState(followEndInitially);
  const pageWindow = getPageWindow(
    totalItems,
    pageSize,
    followingEnd ? Number.MAX_SAFE_INTEGER : requestedPage,
  );

  useEffect(() => {
    if (!followingEnd && requestedPage !== pageWindow.page) {
      setRequestedPage(pageWindow.page);
    }
  }, [followingEnd, pageWindow.page, requestedPage]);

  const movePage = (delta: number) => {
    const nextPage = Math.min(
      pageWindow.pageCount - 1,
      Math.max(0, pageWindow.page + delta),
    );
    setRequestedPage(nextPage);
    setFollowingEnd(nextPage === pageWindow.pageCount - 1);
  };

  const followEnd = () => {
    setRequestedPage(pageWindow.pageCount - 1);
    setFollowingEnd(true);
  };

  return { pageWindow, followingEnd, movePage, followEnd };
}
