import { useContext, useEffect } from 'react'
import { PageTitleContext } from '../lib/pageTitleContext'

// Lets a page announce its name for the fixed header's center title.
export function usePageTitle(title) {
  const { setTitle } = useContext(PageTitleContext)

  useEffect(() => {
    setTitle(title ?? '')
    return () => setTitle('')
  }, [title, setTitle])
}
