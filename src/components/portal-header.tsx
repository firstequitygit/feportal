import Image from 'next/image'
import Link from 'next/link'

interface Props {
  right?: React.ReactNode
  subtitle?: string
}

export function PortalHeader({ right, subtitle }: Props) {
  return (
    <header style={{ backgroundColor: '#FFF6EF', borderBottom: '1px solid #e8ddd6' }}>
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/logo-symbol.png"
            alt="Desco Financial"
            width={40}
            height={40}
            className="h-9 w-auto"
          />
          <div className="hidden sm:flex items-baseline gap-2">
            <span className="text-gray-500 tracking-tight" style={{ fontFamily: 'Arial, sans-serif' }}>
              <span className="font-bold">DESCO Financial</span>
              <span className="font-normal"> Portal</span>
            </span>
            {subtitle && (
              <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">
                {subtitle}
              </span>
            )}
          </div>
        </Link>
        <div className="flex items-center gap-3">
          {right}
        </div>
      </div>
    </header>
  )
}
