import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'))
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result)
    }
    reader.readAsDataURL(blob)
  })
}

export function downloadInBrowser(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function saveOrShareFile(blob: Blob, fileName: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    downloadInBrowser(blob, fileName)
    return
  }

  try {
    const data = await blobToBase64(blob)
    const result = await Filesystem.writeFile({
      path: fileName,
      data,
      directory: Directory.Cache,
      recursive: true,
    })
    await Share.share({
      title: fileName,
      text: fileName,
      url: result.uri,
      dialogTitle: '导出文件',
    })
  } catch (error) {
    console.error('Native file export failed, falling back to browser download.', error)
    downloadInBrowser(blob, fileName)
  }
}
