package kz.naryad.ai

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    requestAppPermissions()
  }

  /** НарядAI: фото (камера/галерея) и голос требуют рантайм-разрешений.
   *  Без этого на свежих Android системный picker пуст, а камера молчит. */
  private fun requestAppPermissions() {
    val wanted = mutableListOf(
      Manifest.permission.CAMERA,
      Manifest.permission.RECORD_AUDIO,
    )
    if (Build.VERSION.SDK_INT >= 33) {
      wanted.add("android.permission.READ_MEDIA_IMAGES")
    } else {
      wanted.add(Manifest.permission.READ_EXTERNAL_STORAGE)
    }
    val missing = wanted.filter {
      ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
    }
    if (missing.isNotEmpty()) {
      ActivityCompat.requestPermissions(this, missing.toTypedArray(), 41)
    }
  }
}
