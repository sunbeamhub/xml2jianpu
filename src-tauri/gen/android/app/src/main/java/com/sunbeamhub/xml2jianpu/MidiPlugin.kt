package com.sunbeamhub.xml2jianpu

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbManager
import android.media.midi.MidiDevice
import android.media.midi.MidiDeviceInfo
import android.media.midi.MidiInputPort
import android.media.midi.MidiManager
import android.media.midi.MidiOutputPort
import android.media.midi.MidiReceiver
import android.os.Build
import android.os.Handler
import android.os.Looper
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * 用系统 MidiManager 收发。USB 类规范的琴由系统 MIDI 服务登记，
 * 这里不调用 UsbManager.requestPermission，避免和系统驱动抢接口。
 * 不链接 libamidi，Android 7 仍能启动。
 */
@TauriPlugin
class MidiPlugin(private val activity: Activity) : Plugin(activity) {
    private val main = Handler(Looper.getMainLooper())
    private val gate = Object()
    private var manager: MidiManager? = null
    private var connected = false
    private var openGeneration = 0
    private var callback: MidiManager.DeviceCallback? = null
    private var usbRegistered = false
    private val opened = ArrayList<OpenedDevice>()
    private var signature = ""

    private val usbReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            scheduleRefresh()
        }
    }

    @Command
    fun connect(invoke: Invoke) {
        Thread {
            try {
                invoke.resolve(openAll())
            } catch (err: Exception) {
                invoke.reject(err.message ?: "连接失败")
            }
        }.start()
    }

    @Command
    fun disconnect(invoke: Invoke) {
        Thread {
            try {
                shutdown()
                invoke.resolve()
            } catch (err: Exception) {
                invoke.reject(err.message ?: "断开失败")
            }
        }.start()
    }

    @Command
    fun send(invoke: Invoke) {
        try {
            val args = invoke.getArgs()
            val portId = args.getString("portId", "") ?: ""
            val raw = args.getJSONArray("bytes")
            val bytes = ByteArray(raw.length())
            for (i in 0 until raw.length()) {
                bytes[i] = raw.getInt(i).toByte()
            }
            if (bytes.isEmpty() || (bytes[0].toInt() and 0xFF < 0xF0 && bytes.size > 3)) {
                invoke.reject("MIDI 消息长度不对")
                return
            }
            synchronized(gate) {
                val port = opened.firstNotNullOfOrNull { it.outputs[portId] }
                    ?: throw IllegalStateException("找不到电子琴输出")
                port.send(bytes, 0, bytes.size, 0)
            }
            invoke.resolve()
        } catch (err: Exception) {
            invoke.reject(err.message ?: "发送失败")
        }
    }

    private fun openAll(): JSObject {
        val mgr = activity.getSystemService(Context.MIDI_SERVICE) as? MidiManager
            ?: return snapshot(false)
        synchronized(gate) {
            shutdownLocked()
            manager = mgr
            connected = true
            registerWatch(mgr)
        }
        val listed = awaitDevices(mgr) ?: return snapshot(false)
        synchronized(gate) {
            if (!connected) return snapshot(false)
            signature = listed.signature
        }
        val ok = listed.inputs.isNotEmpty() || listed.outputs.isNotEmpty()
        if (!ok) shutdown()
        return listed.toJson(ok)
    }

    private fun shutdown() {
        synchronized(gate) {
            shutdownLocked()
        }
    }

    private fun shutdownLocked() {
        connected = false
        signature = ""
        unregisterWatch()
        silenceAndClose()
        manager = null
    }

    private fun registerWatch(mgr: MidiManager) {
        if (callback == null) {
            val watch = object : MidiManager.DeviceCallback() {
                override fun onDeviceAdded(device: MidiDeviceInfo?) {
                    scheduleRefresh()
                }

                override fun onDeviceRemoved(device: MidiDeviceInfo?) {
                    scheduleRefresh()
                }
            }
            mgr.registerDeviceCallback(watch, main)
            callback = watch
        }
        if (!usbRegistered) {
            val filter = IntentFilter().apply {
                addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
                addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
            }
            if (Build.VERSION.SDK_INT >= 33) {
                activity.registerReceiver(usbReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                activity.registerReceiver(usbReceiver, filter)
            }
            usbRegistered = true
        }
    }

    private fun unregisterWatch() {
        val mgr = manager
        val watch = callback
        if (mgr != null && watch != null) {
            mgr.unregisterDeviceCallback(watch)
        }
        callback = null
        if (usbRegistered) {
            try {
                activity.unregisterReceiver(usbReceiver)
            } catch (_: IllegalArgumentException) {
            }
            usbRegistered = false
        }
    }

    private var refreshTicket = 0

    private fun scheduleRefresh() {
        val ticket = synchronized(gate) { ++refreshTicket }
        main.postDelayed({
            val current = synchronized(gate) { refreshTicket }
            if (ticket != current) return@postDelayed
            Thread { refresh() }.start()
        }, 250)
    }

    private fun refresh() {
        val mgr = synchronized(gate) {
            if (!connected) return
            manager
        } ?: return
        val next = deviceSignature(mgr)
        val previous = synchronized(gate) { signature }
        if (next == previous) return
        val listed = awaitDevices(mgr) ?: return
        synchronized(gate) {
            if (!connected) return
            signature = listed.signature
        }
        trigger("ports", listed.toJson(true))
    }

    private fun awaitDevices(mgr: MidiManager): Listed? {
        val infos = mgr.devices ?: emptyArray()
        if (infos.isEmpty()) {
            synchronized(gate) { silenceAndClose() }
            return Listed(emptyList(), emptyList(), "")
        }
        val generation = synchronized(gate) { ++openGeneration }
        val found = ArrayList<OpenedDevice>(infos.size)
        val latch = CountDownLatch(infos.size)
        for (info in infos) {
            mgr.openDevice(info, { device ->
                synchronized(gate) {
                    if (!connected || openGeneration != generation) {
                        try {
                            device?.close()
                        } catch (_: Exception) {
                        }
                    } else if (device != null) {
                        found.add(attach(device))
                    }
                    Unit
                }
                latch.countDown()
            }, main)
        }
        latch.await(5, TimeUnit.SECONDS)
        synchronized(gate) {
            if (!connected || openGeneration != generation) {
                for (item in found) {
                    try {
                        item.device.close()
                    } catch (_: Exception) {
                    }
                }
                return null
            }
            silenceAndClose()
            opened.addAll(found)
        }
        return listedFrom(found)
    }

    private fun attach(device: MidiDevice): OpenedDevice {
        val info = device.info
        val deviceName = info.properties.getString(MidiDeviceInfo.PROPERTY_NAME)?.trim().orEmpty()
            .ifEmpty { "电子琴" }
        val record = OpenedDevice(device)
        val ports = info.ports ?: emptyArray()
        for (port in ports) {
            val portName = port.name?.trim().orEmpty()
            val name = if (portName.isEmpty() || portName == deviceName) {
                deviceName
            } else {
                "$deviceName $portName"
            }
            when (port.type) {
                MidiDeviceInfo.PortInfo.TYPE_INPUT -> {
                    val openedPort = device.openInputPort(port.portNumber) ?: continue
                    val id = "out:${info.id}:${port.portNumber}"
                    record.outputs[id] = openedPort
                    record.outputNames.add(PortName(id, name))
                }
                MidiDeviceInfo.PortInfo.TYPE_OUTPUT -> {
                    val openedPort = device.openOutputPort(port.portNumber) ?: continue
                    val id = "in:${info.id}:${port.portNumber}"
                    val receiver = NoteReceiver()
                    openedPort.connect(receiver)
                    record.inputs.add(openedPort)
                    record.receivers.add(receiver)
                    record.inputNames.add(PortName(id, name))
                }
            }
        }
        return record
    }

    private fun silenceAndClose() {
        for (item in opened) {
            for (port in item.outputs.values) {
                silence(port)
                try {
                    port.close()
                } catch (_: Exception) {
                }
            }
            for (port in item.inputs) {
                try {
                    port.close()
                } catch (_: Exception) {
                }
            }
            try {
                item.device.close()
            } catch (_: Exception) {
            }
        }
        opened.clear()
    }

    private fun silence(port: MidiInputPort) {
        for (channel in 0 until 16) {
            val off = byteArrayOf((0xB0 or channel).toByte(), 120, 0)
            val notes = byteArrayOf((0xB0 or channel).toByte(), 123, 0)
            try {
                port.send(off, 0, off.size, 0)
                port.send(notes, 0, notes.size, 0)
            } catch (_: Exception) {
            }
        }
    }

    private fun deviceSignature(mgr: MidiManager): String {
        val infos = mgr.devices ?: return ""
        return infos.joinToString(",") { info ->
            "${info.id}:${info.inputPortCount}:${info.outputPortCount}"
        }
    }

    private fun listedFrom(found: List<OpenedDevice>): Listed {
        val inputs = ArrayList<PortName>()
        val outputs = ArrayList<PortName>()
        for (item in found) {
            inputs.addAll(item.inputNames)
            outputs.addAll(item.outputNames)
        }
        val signature = found.joinToString(",") { item ->
            val info = item.device.info
            "${info.id}:${info.inputPortCount}:${info.outputPortCount}"
        }
        return Listed(inputs, outputs, signature)
    }

    private fun snapshot(ok: Boolean): JSObject {
        return Listed(emptyList(), emptyList(), "").toJson(ok)
    }

    private class OpenedDevice(val device: MidiDevice) {
        val outputs = HashMap<String, MidiInputPort>()
        val inputs = ArrayList<MidiOutputPort>()
        val receivers = ArrayList<MidiReceiver>()
        val inputNames = ArrayList<PortName>()
        val outputNames = ArrayList<PortName>()
    }

    private data class PortName(val id: String, val name: String)

    private class Listed(
        val inputs: List<PortName>,
        val outputs: List<PortName>,
        val signature: String,
    ) {
        fun toJson(ok: Boolean): JSObject {
            val root = JSObject()
            root.put("ok", ok && (inputs.isNotEmpty() || outputs.isNotEmpty()))
            root.put("inputs", names(inputs))
            root.put("outputs", names(outputs))
            return root
        }

        private fun names(ports: List<PortName>): JSONArray {
            val array = JSONArray()
            for (port in ports) {
                val item = JSObject()
                item.put("id", port.id)
                item.put("name", port.name)
                array.put(item)
            }
            return array
        }
    }

    private inner class NoteReceiver : MidiReceiver() {
        private var running: Int? = null

        override fun onSend(msg: ByteArray, offset: Int, count: Int, timestamp: Long) {
            var index = offset
            val end = offset + count
            while (index < end) {
                val byte = msg[index].toInt() and 0xFF
                if (byte >= 0xF8) {
                    index += 1
                } else if (byte == 0xF0) {
                    running = null
                    index += 1
                    while (index < end && (msg[index].toInt() and 0xFF) != 0xF7) index += 1
                    if (index < end) index += 1
                } else if (byte and 0x80 != 0 && byte >= 0xF0) {
                    val extra = when (byte) {
                        0xF1, 0xF3 -> 1
                        0xF2 -> 2
                        else -> 0
                    }
                    running = null
                    index += 1
                    var left = extra
                    while (left > 0 && index < end) {
                        if ((msg[index].toInt() and 0xFF) < 0xF8) left -= 1
                        index += 1
                    }
                } else {
                    var status = running
                    if (byte and 0x80 != 0) {
                        status = byte
                        running = byte
                        index += 1
                    }
                    if (status == null) {
                        index += 1
                    } else {
                        val needed = if (status and 0xF0 == 0xC0 || status and 0xF0 == 0xD0) 1 else 2
                        val data = IntArray(2)
                        var got = 0
                        var interrupted = false
                        while (got < needed && index < end && !interrupted) {
                            val dataByte = msg[index].toInt() and 0xFF
                            if (dataByte >= 0xF8) {
                                index += 1
                            } else if (dataByte and 0x80 != 0) {
                                interrupted = true
                            } else {
                                data[got] = dataByte
                                got += 1
                                index += 1
                            }
                        }
                        if (!interrupted && got == needed && data[0] <= 127) {
                            when (status and 0xF0) {
                                0x90 -> emit(if (data[1] > 0) "on" else "off", data[0])
                                0x80 -> emit("off", data[0])
                            }
                        }
                        if (!interrupted && got < needed) index = end
                    }
                }
            }
        }

        private fun emit(type: String, midi: Int) {
            val payload = JSObject()
            payload.put("type", type)
            payload.put("midi", midi)
            trigger("note", payload)
        }
    }
}
